const db = require('../../config/db');

exports.list = async (req, res) => {
  try {
    const health_query = `SELECT 1`;
    await db.pool.query(health_query);
    res.json({ status: "pass" });
  } catch (err) {
    console.error(err);
    res.status(503).json({ status: "fail", error: "database unreachable" });
  }
};