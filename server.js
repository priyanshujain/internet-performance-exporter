import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const port = Number(process.env.PORT || 9798)
const interval = Number(process.env.INTERVAL_SECONDS || 3600) * 1000
const timeout = Number(process.env.TIMEOUT_SECONDS || 600) * 1000
const chromium = process.env.CHROMIUM_PATH || '/usr/bin/chromium'
const library = await readFile(new URL('./node_modules/@cloudflare/speedtest/dist/speedtest.js', import.meta.url))
let result = { up: 0 }
let active

const page = token => `<!doctype html><img src="/hold/${token}"><script type="module">import SpeedTest from '/speedtest.js';const send=body=>fetch('/result/${token}',{method:'POST',body:JSON.stringify(body)});const test=new SpeedTest({autoStart:false,logAimApiUrl:null,measurements:[['latency',20],['download',1e5,1,true],['download',1e6,3],['upload',1e5,3,true],['upload',1e6,3],['download',1e7,3],['upload',1e7,3],['download',5e7,2],['upload',25e6,2]].map(([type,a,count,bypassMinDuration])=>type==='latency'?{type,numPackets:a}:{type,bytes:a,count,bypassMinDuration})});test.onFinish=r=>send({result:r.getSummary()});test.onError=error=>send({error});test.play()</script>`

const metrics = () => {
  const values = {
    internet_speedtest_up: result.up,
    internet_download_bits_per_second: result.download,
    internet_upload_bits_per_second: result.upload,
    internet_latency_milliseconds: result.latency,
    internet_jitter_milliseconds: result.jitter,
    internet_download_loaded_latency_milliseconds: result.downLoadedLatency,
    internet_upload_loaded_latency_milliseconds: result.upLoadedLatency,
    internet_speedtest_duration_seconds: result.totalDurationMs && result.totalDurationMs / 1000,
    internet_speedtest_last_attempt_timestamp_seconds: result.attempt,
    internet_speedtest_last_success_timestamp_seconds: result.timestamp
  }
  return Object.entries(values).filter(([, value]) => Number.isFinite(value)).map(([name, value]) => `# TYPE ${name} gauge\n${name} ${value}`).join('\n') + '\n'
}

const server = createServer(async (req, res) => {
  if (req.url === '/metrics') { res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8'); return res.end(metrics()) }
  if (!['127.0.0.1', '::1'].includes(req.socket.remoteAddress)) { res.statusCode = 404; return res.end() }
  if (active && req.url === `/run/${active.token}`) { res.setHeader('Content-Type', 'text/html'); return res.end(page(active.token)) }
  if (active && req.url === `/hold/${active.token}`) { active.hold = res; return }
  if (req.url === '/speedtest.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(library) }
  if (active && req.method === 'POST' && req.url === `/result/${active.token}`) {
    let body = ''
    for await (const chunk of req) body += chunk
    const data = JSON.parse(body)
    if (data.result && ['download', 'upload', 'latency'].every(key => Number.isFinite(data.result[key]))) result = { attempt: result.attempt, ...data.result, up: 1, timestamp: Date.now() / 1000 }
    else result.up = 0
    res.end()
    active.hold?.end()
    active.resolve()
    return
  }
  res.statusCode = 404
  res.end()
})

const run = () => {
  if (active) return
  result.attempt = Date.now() / 1000
  const token = randomUUID()
  let finish
  const done = new Promise(resolve => { let settled = false; finish = () => { if (!settled) { settled = true; resolve() } }; active = { token, resolve: finish } })
  const child = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--dump-dom', `http://127.0.0.1:${port}/run/${token}`], { stdio: 'ignore' })
  const timer = setTimeout(() => { result.up = 0; finish() }, timeout)
  child.on('error', () => { result.up = 0; finish() })
  child.on('exit', () => { if (active) { result.up = 0; finish() } })
  done.finally(() => { clearTimeout(timer); active.hold?.end(); child.kill(); active = undefined })
}

server.listen(port, '0.0.0.0', () => { run(); setInterval(run, interval) })
