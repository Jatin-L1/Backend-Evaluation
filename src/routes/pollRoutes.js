// const express = require('express');
// const router = express.Router();
// const Poll = require('../models/Poll');
// const PollResult = require('../models/PollResult');
// const QRCode = require('qrcode');
// // const sentiment = require('../utils/sentiment');
// const createCsvWriter = require('csv-writer').createObjectCsvWriter;
// const PDFDocument = require('pdfkit');
// const fs = require('fs');
// const { v4: uuidv4 } = require('uuid');
// const { body, validationResult } = require('express-validator'); // External middleware for validation
// const rateLimit = require('express-rate-limit'); // External middleware for rate limiting
// const helmet = require('helmet'); // External middleware for security headers
// const Vote = require('../models/voteModel'); // Assuming you have a Vote model

// // Custom Error class for application-specific errors
// class AppError extends Error {
//   constructor(message, statusCode) {
//     super(message);
//     this.statusCode = statusCode;
//     this.isOperational = true;
//     Error.captureStackTrace(this, this.constructor);
//   }
// }

// // Custom middleware to check if poll exists
// const pollExists = async (req, res, next) => {
//   try {
//     const poll = await Poll.findById(req.params.id);
//     if (!poll) {
//       return next(new AppError('Poll not found', 404));
//     }
//     req.poll = poll; // Attach poll to request object
//     next();
//   } catch (error) {
//     if (error.name === 'CastError') {
//       return next(new AppError('Invalid poll ID format', 400));
//     }
//     next(error);
//   }
// };

// // Middleware to check if user is poll creator
// const isPollCreator = (req, res, next) => {
//   if (req.cookies.creatorId !== req.poll.creatorId) {
//     return next(new AppError('Only poll creator can perform this action', 403));
//   }
//   next();
// };

// // Check if poll has ended middleware
// const checkPollActive = (req, res, next) => {
//   if (new Date() > req.poll.endTime) {
//     return next(new AppError('Poll has ended', 400));
//   }
//   next();
// };

// // Rate limiting middleware to prevent abuse
// const voteLimiter = rateLimit({
//   windowMs: 5 * 60 * 1000, // 5 minutes
//   max: 10, // Limit to 10 votes per 5 minutes per IP
//   message: 'Too many vote attempts, please try again later',
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// // Validation middleware for poll creation
// const validatePollCreation = [
//   body('title').trim().notEmpty().withMessage('Poll title is required').isLength({ max: 200 }).withMessage('Title too long'),
//   body('options').isArray({ min: 2 }).withMessage('At least 2 options are required'),
//   body('options.*').trim().notEmpty().withMessage('Empty options are not allowed'),
//   body('duration').isInt({ min: 1, max: 10080 }).withMessage('Duration must be between 1 minute and 7 days'),
// ];

// // Global error handling middleware
// const errorHandler = (err, req, res, next) => {
//   console.error('Error:', err);
  
//   if (err.isOperational) {
//     return res.status(err.statusCode).render('error', {
//       title: 'Something went wrong',
//       message: err.message
//     });
//   }
  
//   // For non-operational errors (programming errors)
//   res.status(500).render('error', {
//     title: 'Something went wrong',
//     message: 'Server error. Please try again later.'
//   });
// };

// // Async handler to avoid try-catch blocks
// const catchAsync = fn => (req, res, next) => {
//   Promise.resolve(fn(req, res, next)).catch(next);
// };

// module.exports = (io) => {
//   // Apply global middlewares
//   router.use(helmet()); // Security headers

//   router.get('/', catchAsync(async (req, res) => {
//     const polls = await Poll.find().sort({ createdAt: -1 });
//     res.render('index', { polls });
//   }));

//   router.get('/create', (req, res) => {
//     let creatorId = req.cookies.creatorId;
//     if (!creatorId) {
//       creatorId = uuidv4();
//       res.cookie('creatorId', creatorId, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'strict' });
//     }
//     res.render('create-poll', { creatorId });
//   });

//   router.post('/create', validatePollCreation, catchAsync(async (req, res, next) => {
//     // Check validation results
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).render('create-poll', { 
//         errors: errors.array(),
//         formData: req.body 
//       });
//     }

//     const { title, options, isAnonymous, duration } = req.body;
//     const creatorId = req.cookies.creatorId || uuidv4();
//     const endTime = new Date(Date.now() + parseInt(duration) * 60 * 1000);

//     // Non-blocking sentiment analysis
//     // const sentimentPromise = sentiment.analyze(title);
    
//     // Create poll in database
//     const poll = new Poll({
//       title,
//       options: Array.isArray(options) ? options.map(text => ({ text, votes: 0 })) : [{ text: options, votes: 0 }],
//       isAnonymous: !!isAnonymous,
//       endTime,
//       // sentiment: { score: 0, comparative: 0 }, // Default values until sentiment analysis completes
//       creatorId,
//       voters: [],
//       editVersion: 1
//     });

//     // Save poll to get ID immediately
//     await poll.save();
//     const pollId = poll._id.toString();

//     // Schedule poll expiration using non-blocking setTimeout
//     const timeoutId = setTimeout(async () => {
//       try {
//         const expiredPoll = await Poll.findById(pollId);
//         if (!expiredPoll) return; // Poll was already deleted
        
//         // Create a poll result to store the final state
//         const pollResult = new PollResult({
//           title: expiredPoll.title,
//           options: expiredPoll.options,
//           isAnonymous: expiredPoll.isAnonymous,
//           endTime: expiredPoll.endTime,
//           sentiment: expiredPoll.sentiment,
//           creatorId: expiredPoll.creatorId,
//           voters: expiredPoll.voters,
//           editVersion: expiredPoll.editVersion || 1
//         });
        
//         await pollResult.save();
        
//         // Delete the expired poll
//         await Poll.findByIdAndDelete(pollId);
//         console.log(`Poll ${pollId} auto-deleted after ${duration} minutes`);
        
//         // Notify clients that poll has expired
//         io.emit('pollExpired', { pollId });
//       } catch (error) {
//         console.error('Error saving poll result or deleting poll:', error);
//       }
//     }, parseInt(duration) * 60 * 1000);

//     // Store timeout ID in app.locals for later cancellation if needed
//     if (!req.app.locals.pollTimeouts) {
//       req.app.locals.pollTimeouts = {};
//     }
//     req.app.locals.pollTimeouts[pollId] = timeoutId;

//     res.redirect(`/poll/${poll._id}`);
//   }));

//   router.get('/poll/:id', pollExists, catchAsync(async (req, res) => {
//     // Generate QR code asynchronously (non-blocking)
//     const qrCode = await QRCode.toDataURL(`${req.protocol}://${req.get('host')}/poll/${req.poll._id}`);
//     const isCreator = req.cookies.creatorId === req.poll.creatorId;
//     const shareUrl = `${req.protocol}://${req.get('host')}/poll/${req.poll._id}`;
//     const timeLeft = Math.max(0, Math.floor((req.poll.endTime - Date.now()) / 1000));
//     res.render('poll', { poll: req.poll, qrCode, isCreator, shareUrl, timeLeft });
//   }));

// // Update inside your vote handler
// router.post('/poll/:id/vote', async (req, res) => {
//   try {
//     const pollId = req.params.id;
//     console.log('Vote request body:', JSON.stringify(req.body));
    
//     const { optionIndex, location } = req.body;
    
//     // Generate or get user identifier
//     const voter = req.cookies.voterId || require('crypto').randomBytes(16).toString('hex');
    
//     // Set cookie if not exists
//     if (!req.cookies.voterId) {
//       res.cookie('voterId', voter, { 
//         maxAge: 1000 * 60 * 60 * 24 * 365,
//         httpOnly: true,
//         sameSite: 'strict'
//       });
//     }
    
//     // Find the poll and validate the vote
//     const poll = await Poll.findById(pollId);
//     if (!poll) {
//       return res.status(404).json({ error: 'Poll not found' });
//     }
    
//     if (new Date() > new Date(poll.endTime)) {
//       return res.status(400).json({ error: 'Poll has ended' });
//     }
    
//     if (optionIndex < 0 || optionIndex >= poll.options.length) {
//       return res.status(400).json({ error: 'Invalid option' });
//     }
    
//     // Check if user has already voted in this poll
//     const existingVote = await Vote.findOne({ pollId, voter });
//     if (existingVote) {
//       return res.status(400).json({ error: 'You have already voted in this poll' });
//     }
    
//     // Update poll vote count
//     poll.options[optionIndex].votes += 1;
//     await poll.save();
    
//     // Get option text
//     const optionText = poll.options[optionIndex].text;
    
//     // Create location data properly
//     let locationData = null;
    
//     // FIXED: Handle location data explicitly to ensure proper structure
//     if (location && typeof location === 'object') {
//       locationData = {
//         city: String(location.city || 'Unknown City'),
//         country: String(location.country || 'Unknown Country'),
//         latitude: Number(location.latitude) || null,
//         longitude: Number(location.longitude) || null
//       };
      
//       // Make sure lat/long are proper numbers or null
//       if (isNaN(locationData.latitude)) locationData.latitude = null;
//       if (isNaN(locationData.longitude)) locationData.longitude = null;
      
//       console.log('Adding location to vote:', locationData);
//     }
    
//     // Create vote document with explicit field assignment
//     const vote = new Vote({
//       pollId: pollId,
//       optionIndex: optionIndex,
//       voter: voter,
//       optionText: optionText,
//       location: locationData,
//       createdAt: new Date()
//     });
    
//     // Save with explicit promise handling
//     const savedVote = await vote.save();
//     console.log('Vote saved with ID:', savedVote._id);
    
//     // Verify location was saved by retrieving the vote
//     const checkVote = await Vote.findById(savedVote._id);
//     console.log('Retrieved vote has location:', checkVote.location ? 'yes' : 'no');
//     if (checkVote.location) {
//       console.log('Location data:', checkVote.location);
//     }
    
//     // Rest of your code remains the same
//     io.to(pollId).emit('updatePoll', {
//       pollId,
//       options: poll.options
//     });
    
//     if (req.cookies.socketId) {
//       io.to(req.cookies.socketId).emit('voteLocation', {
//         pollId,
//         optionIndex,
//         optionText,
//         location: locationData,
//         timestamp: new Date().toISOString()
//       });
//     } else {
//       io.to(voter).emit('voteLocation', {
//         pollId,
//         optionIndex,
//         optionText,
//         location: locationData,
//         timestamp: new Date().toISOString()
//       });
//     }
    
//     res.status(200).json({ 
//       success: true, 
//       options: poll.options,
//       locationSaved: !!locationData
//     });
//   } catch (error) {
//     console.error('Error voting:', error);
//     res.status(500).json({ error: 'Server error' });
//   }
// });

// // Update your my-votes route handler
// router.get('/my-votes', async (req, res) => {
//   try {
//     const voter = req.cookies.voterId;
    
//     if (!voter) {
//       return res.status(200).json({ votes: [] });
//     }
    
//     // Explicitly select all fields to ensure location is included
//     const votes = await Vote.find({ voter })
//       .select('pollId optionIndex optionText location createdAt')
//       .sort({ createdAt: -1 })
//       .limit(50);
    
//     console.log(`Found ${votes.length} votes for voter ${voter}`);
    
//     // Check each vote's location data and log it
//     votes.forEach((vote, index) => {
//       console.log(`Vote ${index + 1} location:`, vote.location);
//     });
    
//     res.status(200).json({ votes });
//   } catch (error) {
//     console.error('Error fetching votes:', error);
//     res.status(500).json({ error: 'Server error' });
//   }
// });

//   router.get('/poll/:id/export/:format', pollExists, isPollCreator, catchAsync(async (req, res, next) => {
//     const format = req.params.format;
//     const poll = req.poll;
    
//     if (!['csv', 'pdf'].includes(format)) {
//       return next(new AppError('Unsupported export format', 400));
//     }
    
//     const filename = `poll_${poll._id}`;
//     const tempDir = './tmp';
    
//     // Create tmp directory if it doesn't exist
//     if (!fs.existsSync(tempDir)) {
//       fs.mkdirSync(tempDir);
//     }
    
//     const filePath = `${tempDir}/${filename}.${format}`;
    
//     if (format === 'csv') {
//       const csvWriter = createCsvWriter({
//         path: filePath,
//         header: [
//           { id: 'option', title: 'Option' },
//           { id: 'votes', title: 'Votes' }
//         ]
//       });

//       const records = poll.options.map(opt => ({
//         option: opt.text,
//         votes: opt.votes
//       }));

//       await csvWriter.writeRecords(records);
//       res.download(filePath, `${filename}.csv`, (err) => {
//         if (err) next(new AppError('Error downloading file', 500));
        
//         // Clean up file after download (non-blocking)
//         setTimeout(() => {
//           fs.unlink(filePath, (err) => {
//             if (err) console.error('Error deleting temp file:', err);
//           });
//         }, 5000);
//       });
//     } else if (format === 'pdf') {
//       const doc = new PDFDocument();
//       const stream = fs.createWriteStream(filePath);
      
//       // Handle stream errors
//       stream.on('error', (error) => {
//         console.error('Error writing to file stream:', error);
//         return next(new AppError('Error generating PDF', 500));
//       });
      
//       doc.pipe(stream);
//       doc.fontSize(20).text(poll.title, { align: 'center' });
//       poll.options.forEach(opt => {
//         doc.fontSize(14).text(`${opt.text} (${opt.votes})`);
//       });
      
//       doc.end();
      
//       // Wait for PDF to finish writing before sending
//       stream.on('finish', () => {
//         res.download(filePath, `${filename}.pdf`, (err) => {
//           if (err) next(new AppError('Error downloading file', 500));
          
//           // Clean up file after download (non-blocking)
//           setTimeout(() => {
//             fs.unlink(filePath, (err) => {
//               if (err) console.error('Error deleting temp file:', err);
//             });
//           }, 5000);
//         });
//       });
//     }
//   }));

//   // Admin routes
//   router.get('/admin', catchAsync(async (req, res) => {
//     const polls = await Poll.find().sort({ createdAt: -1 });
//     const pollResults = await PollResult.find().sort({ createdAt: -1 }); // Fetch poll results
//     res.render('admin', { polls, pollResults });
//   }));

//   // Delete a poll
//   router.post('/admin/delete/:id', pollExists, catchAsync(async (req, res) => {
//     const poll = req.poll;
    
//     // Cancel any scheduled poll expiration
//     if (req.app.locals.pollTimeouts && req.app.locals.pollTimeouts[req.params.id]) {
//       clearTimeout(req.app.locals.pollTimeouts[req.params.id]);
//       delete req.app.locals.pollTimeouts[req.params.id];
//     }
    
//     // Create a poll result to store the final state
//     const pollResult = new PollResult({
//       title: poll.title,
//       options: poll.options,
//       isAnonymous: poll.isAnonymous,
//       endTime: poll.endTime,
//       sentiment: poll.sentiment,
//       creatorId: poll.creatorId,
//       voters: poll.voters,
//       editVersion: poll.editVersion || 1
//     });
    
//     await pollResult.save();
    
//     // Delete the poll
//     await Poll.findByIdAndDelete(req.params.id);
    
//     // Notify connected clients (non-blocking)
//     process.nextTick(() => {
//       io.emit('pollDeleted', { pollId: req.params.id });
//     });
    
//     res.redirect('/admin');
//   }));

//   // Edit a poll (Show edit form)
//   router.get('/admin/edit/:id', pollExists, catchAsync(async (req, res) => {
//     res.render('edit-poll', { poll: req.poll });
//   }));

//   // Update a poll
//   router.post('/admin/edit/:id', pollExists, [
//     body('title').trim().notEmpty().withMessage('Poll title is required'),
//     body('options').custom(options => {
//       if (!options || (Array.isArray(options) && options.length < 2)) {
//         throw new Error('At least 2 options are required');
//       }
//       return true;
//     }),
//     body('duration').isInt({ min: 1, max: 10080 }).withMessage('Duration must be between 1 minute and 7 days'),
//   ], catchAsync(async (req, res) => {
//     // Check validation errors
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).render('edit-poll', { 
//         errors: errors.array(),
//         poll: req.poll
//       });
//     }
    
//     const { title, isAnonymous, duration } = req.body;
//     let { options } = req.body;
    
//     // Get the existing poll to preserve votes
//     const existingPoll = req.poll;
    
//     // Calculate new end time
//     const currentTime = new Date();
//     const newEndTime = new Date(currentTime.getTime() + parseInt(duration) * 60 * 1000);
    
//     // Ensure options is an array
//     if (!Array.isArray(options)) {
//       options = options ? [options] : [];
//     }
    
//     // Map new options while preserving existing votes
//     // Create a map of existing options for fast lookup
//     const existingOptionsMap = {};
//     existingPoll.options.forEach(opt => {
//       existingOptionsMap[opt.text] = opt.votes;
//     });
    
//     // Determine if options have changed
//     let optionsChanged = false;
    
//     // Check if number of options changed
//     if (existingPoll.options.length !== options.length) {
//       optionsChanged = true;
//     } else {
//       // Check if any option text changed
//       const existingTexts = existingPoll.options.map(opt => opt.text).sort();
//       const newTexts = [...options].sort();
      
//       for (let i = 0; i < existingTexts.length; i++) {
//         if (existingTexts[i] !== newTexts[i]) {
//           optionsChanged = true;
//           break;
//         }
//       }
//     }
    
//     // Create updated options array, preserving votes for unchanged options
//     const updatedOptions = options.map(text => {
//       // If option existed before and options haven't changed, keep its votes
//       if (!optionsChanged && existingOptionsMap.hasOwnProperty(text)) {
//         return { 
//           text, 
//           votes: existingOptionsMap[text] 
//         };
//       }
//       // If options changed or this is a new option, start with 0 votes
//       return { text, votes: 0 };
//     });
    
//     // Increment edit version if options or poll structure changed
//     const newEditVersion = optionsChanged ? (existingPoll.editVersion || 1) + 1 : (existingPoll.editVersion || 1);
    
//     // If options changed, clear voters list to allow re-voting
//     const updatedVoters = optionsChanged ? [] : existingPoll.voters;
    
//     // Save the current state as a PollResult if options changed significantly
//     if (optionsChanged) {
//       // Save current state before updating (non-blocking)
//       const pollResult = new PollResult({
//         title: existingPoll.title,
//         options: existingPoll.options,
//         isAnonymous: existingPoll.isAnonymous,
//         endTime: existingPoll.endTime,
//         sentiment: existingPoll.sentiment,
//         creatorId: existingPoll.creatorId,
//         voters: existingPoll.voters,
//         editVersion: existingPoll.editVersion || 1
//       });
      
//       await pollResult.save();
//     }
    
//     // Update poll with new details
//     const updatedPoll = await Poll.findByIdAndUpdate(
//       req.params.id,
//       {
//         title,
//         options: updatedOptions,
//         isAnonymous: !!isAnonymous,
//         endTime: newEndTime,
//         editVersion: newEditVersion,
//         voters: updatedVoters
//       },
//       { new: true }
//     );
    
//     // Cancel previous expiration timeout and set a new one
//     if (req.app.locals.pollTimeouts && req.app.locals.pollTimeouts[req.params.id]) {
//       clearTimeout(req.app.locals.pollTimeouts[req.params.id]);
//     }
    
//     // Set new timeout for poll expiration
//     const pollId = req.params.id;
//     const timeoutId = setTimeout(async () => {
//       try {
//         const expiredPoll = await Poll.findById(pollId);
//         if (!expiredPoll) return; // Poll was already deleted
        
//         // Create a poll result to store the final state
//         const pollResult = new PollResult({
//           title: expiredPoll.title,
//           options: expiredPoll.options,
//           isAnonymous: expiredPoll.isAnonymous,
//           endTime: expiredPoll.endTime,
//           sentiment: expiredPoll.sentiment,
//           creatorId: expiredPoll.creatorId,
//           voters: expiredPoll.voters,
//           editVersion: expiredPoll.editVersion || 1
//         });
        
//         await pollResult.save();

//         // Delete the expired poll
//         await Poll.findByIdAndDelete(pollId);
//         console.log(`Poll ${pollId} auto-deleted after expiration`);
        
//         // Notify clients (non-blocking)
//         io.emit('pollExpired', { pollId });
//       } catch (error) {
//         console.error('Error saving poll result or deleting poll:', error);
//       }
//     }, parseInt(duration) * 60 * 1000);
    
//     // Store new timeout ID
//     if (!req.app.locals.pollTimeouts) {
//       req.app.locals.pollTimeouts = {};
//     }
//     req.app.locals.pollTimeouts[pollId] = timeoutId;
    
//     // Notify connected clients about the poll update (non-blocking)
//     process.nextTick(() => {
//       io.emit('updatePoll', { 
//         pollId: req.params.id, 
//         options: updatedPoll.options,
//         title: updatedPoll.title,
//         endTime: updatedPoll.endTime,
//         editVersion: updatedPoll.editVersion
//       });
//     });
    
//     res.redirect('/admin');
//   }));

//   // Apply error handler at the end
//   router.use(errorHandler);

//   return router;
// };
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); // Add mongoose import at the top
const Poll = require('../models/Poll');
const PollResult = require('../models/PollResult');
const QRCode = require('qrcode');
// const sentiment = require('../utils/sentiment');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator'); // External middleware for validation
const rateLimit = require('express-rate-limit'); // External middleware for rate limiting
const helmet = require('helmet'); // External middleware for security headers
const Vote = require('../models/voteModel'); // Assuming you have a Vote model

// Custom Error class for application-specific errors
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Custom middleware to check if poll exists
const pollExists = async (req, res, next) => {
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) {
      return next(new AppError('Poll not found', 404));
    }
    req.poll = poll; // Attach poll to request object
    next();
  } catch (error) {
    if (error.name === 'CastError') {
      return next(new AppError('Invalid poll ID format', 400));
    }
    next(error);
  }
};

// Middleware to check if user is poll creator
const isPollCreator = (req, res, next) => {
  if (req.cookies.creatorId !== req.poll.creatorId) {
    return next(new AppError('Only poll creator can perform this action', 403));
  }
  next();
};

// Check if poll has ended middleware
const checkPollActive = (req, res, next) => {
  if (new Date() > req.poll.endTime) {
    return next(new AppError('Poll has ended', 400));
  }
  next();
};

// Rate limiting middleware to prevent abuse
const voteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit to 10 votes per 5 minutes per IP
  message: 'Too many vote attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware for poll creation
const validatePollCreation = [
  body('title').trim().notEmpty().withMessage('Poll title is required').isLength({ max: 200 }).withMessage('Title too long'),
  body('options').isArray({ min: 2 }).withMessage('At least 2 options are required'),
  body('options.*').trim().notEmpty().withMessage('Empty options are not allowed'),
  body('duration').isInt({ min: 1, max: 10080 }).withMessage('Duration must be between 1 minute and 7 days'),
];

// Global error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.isOperational) {
    return res.status(err.statusCode).render('error', {
      title: 'Something went wrong',
      message: err.message
    });
  }
  
  // For non-operational errors (programming errors)
  res.status(500).render('error', {
    title: 'Something went wrong',
    message: 'Server error. Please try again later.'
  });
};

// Async handler to avoid try-catch blocks
const catchAsync = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = (io) => {
  // Apply global middlewares
  router.use(helmet()); // Security headers

  router.get('/', catchAsync(async (req, res) => {
    const polls = await Poll.find().sort({ createdAt: -1 });
    res.render('index', { polls });
  }));

  router.get('/create', (req, res) => {
    let creatorId = req.cookies.creatorId;
    if (!creatorId) {
      creatorId = uuidv4();
      res.cookie('creatorId', creatorId, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'strict' });
    }
    res.render('create-poll', { creatorId });
  });

  router.post('/create', validatePollCreation, catchAsync(async (req, res, next) => {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('create-poll', { 
        errors: errors.array(),
        formData: req.body 
      });
    }

    const { title, options, isAnonymous, duration } = req.body;
    const creatorId = req.cookies.creatorId || uuidv4();
    const endTime = new Date(Date.now() + parseInt(duration) * 60 * 1000);

    // Non-blocking sentiment analysis
    // const sentimentPromise = sentiment.analyze(title);
    
    // Create poll in database
    const poll = new Poll({
      title,
      options: Array.isArray(options) ? options.map(text => ({ text, votes: 0 })) : [{ text: options, votes: 0 }],
      isAnonymous: !!isAnonymous,
      endTime,
      // sentiment: { score: 0, comparative: 0 }, // Default values until sentiment analysis completes
      creatorId,
      voters: [],
      editVersion: 1
    });

    // Save poll to get ID immediately
    await poll.save();
    const pollId = poll._id.toString();

    // Schedule poll expiration using non-blocking setTimeout
    const timeoutId = setTimeout(async () => {
      try {
        const expiredPoll = await Poll.findById(pollId);
        if (!expiredPoll) return; // Poll was already deleted
        
        // Create a poll result to store the final state
        const pollResult = new PollResult({
          title: expiredPoll.title,
          options: expiredPoll.options,
          isAnonymous: expiredPoll.isAnonymous,
          endTime: expiredPoll.endTime,
          sentiment: expiredPoll.sentiment,
          creatorId: expiredPoll.creatorId,
          voters: expiredPoll.voters,
          editVersion: expiredPoll.editVersion || 1
        });
        
        await pollResult.save();
        
        // Delete the expired poll
        await Poll.findByIdAndDelete(pollId);
        console.log(`Poll ${pollId} auto-deleted after ${duration} minutes`);
        
        // Notify clients that poll has expired
        io.emit('pollExpired', { pollId });
      } catch (error) {
        console.error('Error saving poll result or deleting poll:', error);
      }
    }, parseInt(duration) * 60 * 1000);

    // Store timeout ID in app.locals for later cancellation if needed
    if (!req.app.locals.pollTimeouts) {
      req.app.locals.pollTimeouts = {};
    }
    req.app.locals.pollTimeouts[pollId] = timeoutId;

    res.redirect(`/poll/${poll._id}`);
  }));

  router.get('/poll/:id', pollExists, catchAsync(async (req, res) => {
    // Generate QR code asynchronously (non-blocking)
    const qrCode = await QRCode.toDataURL(`${req.protocol}://${req.get('host')}/poll/${req.poll._id}`);
    const isCreator = req.cookies.creatorId === req.poll.creatorId;
    const shareUrl = `${req.protocol}://${req.get('host')}/poll/${req.poll._id}`;
    const timeLeft = Math.max(0, Math.floor((req.poll.endTime - Date.now()) / 1000));
    res.render('poll', { poll: req.poll, qrCode, isCreator, shareUrl, timeLeft });
  }));

  // New route to get vote locations for a specific poll
  router.get('/api/poll/:id/locations', async (req, res) => {
    try {
      const pollId = req.params.id;
      
      // Validate pollId
      if (!mongoose.Types.ObjectId.isValid(pollId)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid poll ID format'
        });
      }
      
      // Query MongoDB for vote locations
      const votes = await Vote.find({ pollId })
        .select('pollId optionIndex optionText location createdAt')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      
      // Format the location data
      const locations = votes.map(vote => ({
        pollId: vote.pollId.toString(),
        optionIndex: vote.optionIndex,
        optionText: vote.optionText || 'Unknown option',
        location: {
          city: vote.location?.city || 'Unknown City',
          country: vote.location?.country || 'Unknown Country',
          latitude: vote.location?.latitude || null,
          longitude: vote.location?.longitude || null
        },
        timestamp: vote.createdAt || new Date().toISOString()
      }));
      
      return res.status(200).json({
        status: 'success',
        count: locations.length,
        locations
      });
    } catch (error) {
      console.error('Error fetching vote locations:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch vote locations'
      });
    }
  });

  // Update inside your vote handler
  router.post('/poll/:id/vote', async (req, res) => {
    try {
      const pollId = req.params.id;
      console.log('Vote request body:', JSON.stringify(req.body));
      
      const { optionIndex, location } = req.body;
      
      // Generate or get user identifier
      const voter = req.cookies.voterId || require('crypto').randomBytes(16).toString('hex');
      
      // Set cookie if not exists
      if (!req.cookies.voterId) {
        res.cookie('voterId', voter, { 
          maxAge: 1000 * 60 * 60 * 24 * 365,
          httpOnly: true,
          sameSite: 'strict'
        });
      }
      
      // Find the poll and validate the vote
      const poll = await Poll.findById(pollId);
      if (!poll) {
        return res.status(404).json({ error: 'Poll not found' });
      }
      
      if (new Date() > new Date(poll.endTime)) {
        return res.status(400).json({ error: 'Poll has ended' });
      }
      
      if (optionIndex < 0 || optionIndex >= poll.options.length) {
        return res.status(400).json({ error: 'Invalid option' });
      }
      
      // Check if user has already voted in this poll
      const existingVote = await Vote.findOne({ pollId, voter });
      if (existingVote) {
        return res.status(400).json({ error: 'You have already voted in this poll' });
      }
      
      // Update poll vote count
      poll.options[optionIndex].votes += 1;
      await poll.save();
      
      // Get option text
      const optionText = poll.options[optionIndex].text;
      
      // Create location data properly
      let locationData = null;
      
      // FIXED: Handle location data explicitly to ensure proper structure
      if (location && typeof location === 'object') {
        locationData = {
          city: String(location.city || 'Unknown City'),
          country: String(location.country || 'Unknown Country'),
          latitude: Number(location.latitude) || null,
          longitude: Number(location.longitude) || null
        };
        
        // Make sure lat/long are proper numbers or null
        if (isNaN(locationData.latitude)) locationData.latitude = null;
        if (isNaN(locationData.longitude)) locationData.longitude = null;
        
        console.log('Adding location to vote:', locationData);
      }
      
      // Create vote document with explicit field assignment
      const vote = new Vote({
        pollId: pollId,
        optionIndex: optionIndex,
        voter: voter,
        optionText: optionText,
        location: locationData,
        createdAt: new Date()
      });
      
      // Save with explicit promise handling
      const savedVote = await vote.save();
      console.log('Vote saved with ID:', savedVote._id);
      
      // Verify location was saved by retrieving the vote
      const checkVote = await Vote.findById(savedVote._id);
      console.log('Retrieved vote has location:', checkVote.location ? 'yes' : 'no');
      if (checkVote.location) {
        console.log('Location data:', checkVote.location);
      }
      
      // Rest of your code remains the same
      io.to(pollId).emit('updatePoll', {
        pollId,
        options: poll.options
      });
      
      if (req.cookies.socketId) {
        io.to(req.cookies.socketId).emit('voteLocation', {
          pollId,
          optionIndex,
          optionText,
          location: locationData,
          timestamp: new Date().toISOString()
        });
      } else {
        io.to(voter).emit('voteLocation', {
          pollId,
          optionIndex,
          optionText,
          location: locationData,
          timestamp: new Date().toISOString()
        });
      }
      
      res.status(200).json({ 
        success: true, 
        options: poll.options,
        locationSaved: !!locationData
      });
    } catch (error) {
      console.error('Error voting:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Update your my-votes route handler
  router.get('/my-votes', async (req, res) => {
    try {
      const voter = req.cookies.voterId;
      
      if (!voter) {
        return res.status(200).json({ votes: [] });
      }
      
      // Explicitly select all fields to ensure location is included
      const votes = await Vote.find({ voter })
        .select('pollId optionIndex optionText location createdAt')
        .sort({ createdAt: -1 })
        .limit(50);
      
      console.log(`Found ${votes.length} votes for voter ${voter}`);
      
      // Check each vote's location data and log it
      votes.forEach((vote, index) => {
        console.log(`Vote ${index + 1} location:`, vote.location);
      });
      
      res.status(200).json({ votes });
    } catch (error) {
      console.error('Error fetching votes:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.get('/poll/:id/export/:format', pollExists, isPollCreator, catchAsync(async (req, res, next) => {
    const format = req.params.format;
    const poll = req.poll;
    
    if (!['csv', 'pdf'].includes(format)) {
      return next(new AppError('Unsupported export format', 400));
    }
    
    const filename = `poll_${poll._id}`;
    const tempDir = './tmp';
    
    // Create tmp directory if it doesn't exist
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    const filePath = `${tempDir}/${filename}.${format}`;
    
    if (format === 'csv') {
      const csvWriter = createCsvWriter({
        path: filePath,
        header: [
          { id: 'option', title: 'Option' },
          { id: 'votes', title: 'Votes' }
        ]
      });

      const records = poll.options.map(opt => ({
        option: opt.text,
        votes: opt.votes
      }));

      await csvWriter.writeRecords(records);
      res.download(filePath, `${filename}.csv`, (err) => {
        if (err) next(new AppError('Error downloading file', 500));
        
        // Clean up file after download (non-blocking)
        setTimeout(() => {
          fs.unlink(filePath, (err) => {
            if (err) console.error('Error deleting temp file:', err);
          });
        }, 5000);
      });
    } else if (format === 'pdf') {
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(filePath);
      
      // Handle stream errors
      stream.on('error', (error) => {
        console.error('Error writing to file stream:', error);
        return next(new AppError('Error generating PDF', 500));
      });
      
      doc.pipe(stream);
      doc.fontSize(20).text(poll.title, { align: 'center' });
      poll.options.forEach(opt => {
        doc.fontSize(14).text(`${opt.text} (${opt.votes})`);
      });
      
      doc.end();
      
      // Wait for PDF to finish writing before sending
      stream.on('finish', () => {
        res.download(filePath, `${filename}.pdf`, (err) => {
          if (err) next(new AppError('Error downloading file', 500));
          
          // Clean up file after download (non-blocking)
          setTimeout(() => {
            fs.unlink(filePath, (err) => {
              if (err) console.error('Error deleting temp file:', err);
            });
          }, 5000);
        });
      });
    }
  }));

  // Admin routes
  router.get('/admin', catchAsync(async (req, res) => {
    const polls = await Poll.find().sort({ createdAt: -1 });
    const pollResults = await PollResult.find().sort({ createdAt: -1 }); // Fetch poll results
    res.render('admin', { polls, pollResults });
  }));

  // Delete a poll
  router.post('/admin/delete/:id', pollExists, catchAsync(async (req, res) => {
    const poll = req.poll;
    
    // Cancel any scheduled poll expiration
    if (req.app.locals.pollTimeouts && req.app.locals.pollTimeouts[req.params.id]) {
      clearTimeout(req.app.locals.pollTimeouts[req.params.id]);
      delete req.app.locals.pollTimeouts[req.params.id];
    }
    
    // Create a poll result to store the final state
    const pollResult = new PollResult({
      title: poll.title,
      options: poll.options,
      isAnonymous: poll.isAnonymous,
      endTime: poll.endTime,
      sentiment: poll.sentiment,
      creatorId: poll.creatorId,
      voters: poll.voters,
      editVersion: poll.editVersion || 1
    });
    
    await pollResult.save();
    
    // Delete the poll
    await Poll.findByIdAndDelete(req.params.id);
    
    // Notify connected clients (non-blocking)
    process.nextTick(() => {
      io.emit('pollDeleted', { pollId: req.params.id });
    });
    
    res.redirect('/admin');
  }));

  // Edit a poll (Show edit form)
  router.get('/admin/edit/:id', pollExists, catchAsync(async (req, res) => {
    res.render('edit-poll', { poll: req.poll });
  }));

  // Update a poll
  router.post('/admin/edit/:id', pollExists, [
    body('title').trim().notEmpty().withMessage('Poll title is required'),
    body('options').custom(options => {
      if (!options || (Array.isArray(options) && options.length < 2)) {
        throw new Error('At least 2 options are required');
      }
      return true;
    }),
    body('duration').isInt({ min: 1, max: 10080 }).withMessage('Duration must be between 1 minute and 7 days'),
  ], catchAsync(async (req, res) => {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('edit-poll', { 
        errors: errors.array(),
        poll: req.poll
      });
    }
    
    const { title, isAnonymous, duration } = req.body;
    let { options } = req.body;
    
    // Get the existing poll to preserve votes
    const existingPoll = req.poll;
    
    // Calculate new end time
    const currentTime = new Date();
    const newEndTime = new Date(currentTime.getTime() + parseInt(duration) * 60 * 1000);
    
    // Ensure options is an array
    if (!Array.isArray(options)) {
      options = options ? [options] : [];
    }
    
    // Map new options while preserving existing votes
    // Create a map of existing options for fast lookup
    const existingOptionsMap = {};
    existingPoll.options.forEach(opt => {
      existingOptionsMap[opt.text] = opt.votes;
    });
    
    // Determine if options have changed
    let optionsChanged = false;
    
    // Check if number of options changed
    if (existingPoll.options.length !== options.length) {
      optionsChanged = true;
    } else {
      // Check if any option text changed
      const existingTexts = existingPoll.options.map(opt => opt.text).sort();
      const newTexts = [...options].sort();
      
      for (let i = 0; i < existingTexts.length; i++) {
        if (existingTexts[i] !== newTexts[i]) {
          optionsChanged = true;
          break;
        }
      }
    }
    
    // Create updated options array, preserving votes for unchanged options
    const updatedOptions = options.map(text => {
      // If option existed before and options haven't changed, keep its votes
      if (!optionsChanged && existingOptionsMap.hasOwnProperty(text)) {
        return { 
          text, 
          votes: existingOptionsMap[text] 
        };
      }
      // If options changed or this is a new option, start with 0 votes
      return { text, votes: 0 };
    });
    
    // Increment edit version if options or poll structure changed
    const newEditVersion = optionsChanged ? (existingPoll.editVersion || 1) + 1 : (existingPoll.editVersion || 1);
    
    // If options changed, clear voters list to allow re-voting
    const updatedVoters = optionsChanged ? [] : existingPoll.voters;
    
    // Save the current state as a PollResult if options changed significantly
    if (optionsChanged) {
      // Save current state before updating (non-blocking)
      const pollResult = new PollResult({
        title: existingPoll.title,
        options: existingPoll.options,
        isAnonymous: existingPoll.isAnonymous,
        endTime: existingPoll.endTime,
        sentiment: existingPoll.sentiment,
        creatorId: existingPoll.creatorId,
        voters: existingPoll.voters,
        editVersion: existingPoll.editVersion || 1
      });
      
      await pollResult.save();
    }
    
    // Update poll with new details
    const updatedPoll = await Poll.findByIdAndUpdate(
      req.params.id,
      {
        title,
        options: updatedOptions,
        isAnonymous: !!isAnonymous,
        endTime: newEndTime,
        editVersion: newEditVersion,
        voters: updatedVoters
      },
      { new: true }
    );
    
    // Cancel previous expiration timeout and set a new one
    if (req.app.locals.pollTimeouts && req.app.locals.pollTimeouts[req.params.id]) {
      clearTimeout(req.app.locals.pollTimeouts[req.params.id]);
    }
    
    // Set new timeout for poll expiration
    const pollId = req.params.id;
    const timeoutId = setTimeout(async () => {
      try {
        const expiredPoll = await Poll.findById(pollId);
        if (!expiredPoll) return; // Poll was already deleted
        
        // Create a poll result to store the final state
        const pollResult = new PollResult({
          title: expiredPoll.title,
          options: expiredPoll.options,
          isAnonymous: expiredPoll.isAnonymous,
          endTime: expiredPoll.endTime,
          sentiment: expiredPoll.sentiment,
          creatorId: expiredPoll.creatorId,
          voters: expiredPoll.voters,
          editVersion: expiredPoll.editVersion || 1
        });
        
        await pollResult.save();

        // Delete the expired poll
        await Poll.findByIdAndDelete(pollId);
        console.log(`Poll ${pollId} auto-deleted after expiration`);
        
        // Notify clients (non-blocking)
        io.emit('pollExpired', { pollId });
      } catch (error) {
        console.error('Error saving poll result or deleting poll:', error);
      }
    }, parseInt(duration) * 60 * 1000);
    
    // Store new timeout ID
    if (!req.app.locals.pollTimeouts) {
      req.app.locals.pollTimeouts = {};
    }
    req.app.locals.pollTimeouts[pollId] = timeoutId;
    
    // Notify connected clients about the poll update (non-blocking)
    process.nextTick(() => {
      io.emit('updatePoll', { 
        pollId: req.params.id, 
        options: updatedPoll.options,
        title: updatedPoll.title,
        endTime: updatedPoll.endTime,
        editVersion: updatedPoll.editVersion
      });
    });
    
    res.redirect('/admin');
  }));

  // Apply error handler at the end
  router.use(errorHandler);

  return router;
};