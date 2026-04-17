// Rate limiter com jitter para broadcast engine (Sprint 5 / T3).

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForNextSlot(campanha) {
  const rate = Math.max(1, Number(campanha.rate_limit_per_min) || 20);
  const jitterMin = Math.max(0, Number(campanha.jitter_min_sec) || 3);
  const jitterMaxRaw = Number(campanha.jitter_max_sec);
  const jitterMax = Number.isFinite(jitterMaxRaw) && jitterMaxRaw >= jitterMin
    ? jitterMaxRaw : Math.max(jitterMin, 8);

  const intervalSec = 60 / rate;
  const jitter = jitterMin + Math.random() * (jitterMax - jitterMin);
  const totalMs = (intervalSec + jitter) * 1000;
  await sleep(totalMs);
  return totalMs;
}

module.exports = { waitForNextSlot, sleep };
