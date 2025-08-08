process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const app = require('./src/app');
const PORT = process.env.PORT || 3000;
const db = require('./config/db');

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// set up CRON for view refresh:
db.pg_boss();