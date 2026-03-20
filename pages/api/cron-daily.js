export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date().toISOString();
  console.log(`[CRON] Daily rank check triggered at ${now}`);

  return res.status(200).json({
    triggered: true,
    time: now,
    message: "Daily cron fired",
  });
}

export const config = {
  maxDuration: 300,
};
