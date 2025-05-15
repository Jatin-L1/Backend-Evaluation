const axios = require('axios');

const TEXTRAZOR_API_KEY = '3674250708126744aba53344f7590e745f3437ace2e43ebfb282cb80';
const TEXTRAZOR_API_URL = 'https://api.textrazor.com';

module.exports = {
  analyze: async (text) => {
    try {
      const response = await axios.post(`${TEXTRAZOR_API_URL}/`, `text=${encodeURIComponent(text)}&extractors=entities,sentiment`, {
        headers: {
          'x-textrazor-key': TEXTRAZOR_API_KEY,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      console.log('TextRazor response:', response.data);

      const sentimentData = response.data.response.sentiment;
      if (!sentimentData || !sentimentData.aggregate) {
        console.warn('Sentiment data is missing or incomplete');
        return {
          score: 0,
          comparative: 0
        };
      }

      return {
        score: sentimentData.aggregate.score,
        comparative: sentimentData.aggregate.score / text.split(' ').length
      };
    } catch (error) {
      console.error('Error analyzing sentiment:', error);
      throw error;
    }
  }
};