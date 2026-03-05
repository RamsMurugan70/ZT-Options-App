const winston = require('winston');
const path = require('path');

const transports = [
    new winston.transports.Console({
        format: winston.format.simple(),
    }),
];

// Only write log files in development (avoids unbounded growth on cloud)
if (process.env.NODE_ENV !== 'production') {
    transports.push(
        new winston.transports.File({ filename: 'error.log', level: 'error', maxsize: 10 * 1024 * 1024, maxFiles: 3 }),
        new winston.transports.File({ filename: 'combined.log', maxsize: 10 * 1024 * 1024, maxFiles: 3 })
    );
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports,
});

module.exports = logger;
