const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const pollRoutes = require('./src/routes/pollRoutes');
require('dotenv').config();

process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.error(err.name, err.message, err.stack);
  process.exit(1);
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// IMPORTANT: Helmet configuration with proper CSP to allow ipapi.co
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'", "https://ipapi.co", "wss://*", "ws://*", "*"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"]
    }
  }
}));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

const globalLimiter = rateLimit({
  max: 100, 
  windowMs: 60 * 60 * 1000,
  message: 'Too many requests from this IP, please try again in an hour!'
});
app.use('/api', globalLimiter); 

app.use(express.json({ limit: '10kb' })); 
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

app.use(mongoSanitize());
app.use(xss());
app.use(hpp({
  whitelist: ['title', 'options']
}));

app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'Server is running' });
});

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  autoIndex: process.env.NODE_ENV !== 'production' 
})
.then(() => console.log('MongoDB Connected Successfully!'))
.catch(err => {
  console.error('MongoDB connection error:', err.message);
  process.exit(1);
});

const fs = require('fs');
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

// Store vote history for each poll
const voteHistory = {};

// Socket.io connection handler with proper vote tracking
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Store socket ID in cookie through client-side code
  socket.emit('setSocketId', { socketId: socket.id });
  
  socket.on('joinPoll', (pollId) => {
    socket.join(pollId); 
    console.log(`Client ${socket.id} joined poll: ${pollId}`);
    
    // Send vote history to the client for this poll
    if (voteHistory[pollId] && voteHistory[pollId].length > 0) {
      console.log(`Sending ${voteHistory[pollId].length} votes to client for poll ${pollId}`);
      socket.emit('voteHistory', voteHistory[pollId]);
    } else {
      console.log(`No vote history to send for poll ${pollId}`);
      socket.emit('voteHistory', []);
    }
  });
  
  // Add a handler for vote history requests
  socket.on('requestVoteHistory', (pollId) => {
    if (voteHistory[pollId]) {
      console.log(`Sending ${voteHistory[pollId].length} votes to client on request for poll ${pollId}`);
      socket.emit('voteHistory', voteHistory[pollId]);
    } else {
      console.log(`No vote history available for poll ${pollId} on request`);
      socket.emit('voteHistory', []);
    }
  });
  
  socket.on('vote', (data) => {
    console.log(`Socket vote event received`);
    
    if (!data.location) {
      console.log('Warning: Vote received without location data');
      return;
    }
    
    console.log(`Vote location data:`, JSON.stringify(data.location));
    
    if (data.location && typeof data.location === 'object') {
      // Create a clean copy of location data
      const locationData = {
        city: String(data.location.city || 'Unknown City'),
        country: String(data.location.country || 'Unknown Country'),
        latitude: Number(data.location.latitude) || null,
        longitude: Number(data.location.longitude) || null
      };
      
      // Create vote record
      const voteRecord = {
        pollId: data.pollId,
        optionIndex: data.optionIndex,
        location: locationData,
        optionText: data.optionText,
        timestamp: new Date().toISOString()
      };
      
      // Store in vote history
      if (!voteHistory[data.pollId]) {
        voteHistory[data.pollId] = [];
      }
      voteHistory[data.pollId].unshift(voteRecord);
      
      // Limit to 50 items
      if (voteHistory[data.pollId].length > 50) {
        voteHistory[data.pollId] = voteHistory[data.pollId].slice(0, 50);
      }
      
      // Broadcast to all clients in the poll room
      io.to(data.pollId).emit('updatePoll', voteRecord);
      console.log('Emitted updatePoll with location data to room:', data.pollId);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

app.use('/', pollRoutes(io)); 

app.all('*', (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.status = 'fail';
  err.statusCode = 404;
  next(err);
});

app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (req.originalUrl.startsWith('/api')) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && { error: err, stack: err.stack })
    });
  }
  
  return res.status(err.statusCode).render('error', {
    title: 'Something went wrong',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Please try again later'
  });
});

const PORT = process.env.PORT || 10000;
const server_instance = server.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...');
  console.error(err.name, err.message);
  server_instance.close(() => {
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  console.log('👋 SIGTERM RECEIVED. Shutting down gracefully');
  server_instance.close(() => {
    console.log('💥 Process terminated!');
  });
});