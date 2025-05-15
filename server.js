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
const Vote = require('./src/models/voteModel');
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

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
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

// Function to fetch votes from MongoDB
async function getVotesFromDB(pollId) {
  try {
    console.log(`Fetching votes from MongoDB for poll ${pollId}`);
    
    const votes = await Vote.find({ pollId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    
    console.log(`Retrieved ${votes.length} votes from MongoDB for poll ${pollId}`);
    
    // Format the votes for client with explicit property access
    const formattedVotes = votes.map(vote => {
      console.log('Processing vote:', JSON.stringify(vote));
      
      return {
        pollId: vote.pollId ? vote.pollId.toString() : pollId,
        optionIndex: vote.optionIndex,
        optionText: vote.optionText || 'Unknown option',
        location: {
          city: vote.location?.city || 'Unknown City',
          country: vote.location?.country || 'Unknown Country',
          latitude: vote.location?.latitude || null,
          longitude: vote.location?.longitude || null
        },
        timestamp: vote.createdAt || new Date().toISOString()
      };
    });
    
    console.log(`Formatted ${formattedVotes.length} votes for client`);
    return formattedVotes;
  } catch (err) {
    console.error(`Error fetching votes from MongoDB for poll ${pollId}:`, err);
    return [];
  }
}

// Socket.io connection handler with proper vote tracking
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('joinPoll', async (pollId) => {
    socket.join(pollId);
    console.log(`Client ${socket.id} joined poll: ${pollId}`);
    
    try {
      // Always fetch fresh votes from database on join
      const dbVotes = await getVotesFromDB(pollId);
      
      if (dbVotes && dbVotes.length > 0) {
        console.log(`Sending ${dbVotes.length} votes to client ${socket.id} for poll ${pollId}`);
        socket.emit('voteHistory', dbVotes);
        
        // Update memory cache
        voteHistory[pollId] = dbVotes;
      } else {
        console.log(`No votes found for poll ${pollId}`);
        socket.emit('voteHistory', []);
      }
    } catch (error) {
      console.error(`Error getting votes for poll ${pollId}:`, error);
      socket.emit('voteHistory', []);
    }
  });
  
  socket.on('requestVoteHistory', async (pollId) => {
    try {
      console.log(`Client ${socket.id} requested vote history for poll ${pollId}`);
      
      // Always fetch fresh from database
      const dbVotes = await getVotesFromDB(pollId);
      
      if (dbVotes && dbVotes.length > 0) {
        // Update memory for future use
        voteHistory[pollId] = dbVotes;
        console.log(`Sending ${dbVotes.length} votes from database for poll ${pollId}`);
        socket.emit('voteHistory', dbVotes);
      } else {
        console.log(`No votes found in database for poll ${pollId}`);
        socket.emit('voteHistory', []);
      }
    } catch (error) {
      console.error(`Error handling requestVoteHistory for poll ${pollId}:`, error);
      socket.emit('voteHistory', []);
    }
  });
  
  socket.on('vote', (data) => {
    console.log(`Socket vote event received from ${socket.id}`);
    
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
      
      // Also send a direct confirmation to the client
      socket.emit('voteConfirmed', voteRecord);
    }
  });
  
  // Handle pings for connection testing
  socket.on('ping', (data) => {
    socket.emit('pong', { 
      received: data, 
      serverTime: new Date().toISOString() 
    });
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
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