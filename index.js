export default function handler(req, res) {
  return res.status(200).json({
    success: true,
    service: "UniPulse Call Proxy",
    status: "online",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
}
