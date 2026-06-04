const mongoose = require('mongoose');

const connectDB = async (retryCount = 0) => {
  const maxRetries = 5;
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`MongoDB connection error (attempt ${retryCount + 1}/${maxRetries}):`, err.message);
    if (retryCount < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
      console.log(`Retrying MongoDB connection in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return connectDB(retryCount + 1);
    }
    console.error('Max MongoDB connection retries reached. Exiting.');
    process.exit(1);
  }
};

module.exports = { connectDB };