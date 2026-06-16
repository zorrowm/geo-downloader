const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.QR_ADMIN_PORT || 9090)
const UPLOAD_DIR = process.env.QR_UPLOAD_DIR || 'C:/nginx-1.30.2/packages/qr-assets'
const TOKEN_FILE = process.env.QR_ADMIN_TOKEN_FILE || 'C:/nginx-1.30.2/qr-admin-token.txt'
const BASE_PATH = '/qr-admin'

const SLOTS = [
  { key: 'gzh', file: 'gzh.jpg', label: '微信公众号' },
  { key: 'wxq', file: 'wxq_sq.png', label: '技术交流群' },
  { key: 'wx', file: 'wx.jpg', label: '微信收款码' },
  { key: 'zfb', file: 'zfb.jpg', label: '支付宝收款码' },
]

function readToken() {
  return fs.readFileSync(TOKEN_FILE, 'utf8').trim()
}

function html() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR Code Manager</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f0f2f5; padding: 24px; min-height: 100vh; }
.container { max-width: 720px; margin: 0 auto; }
h1 { font-size: 1.4rem; margin-bottom: 24px; color: #1a1a1a; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
@media (max-width: 500px) { .grid { grid-template-columns: 1fr; } }
.card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,.06);
  display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: all .2s;
  border: 2px solid transparent; position: relative; overflow: hidden; }
.card:hover { border-color: #2563eb; box-shadow: 0 4px 16px rgba(37,99,235,.15); transform: translateY(-2px); }
.card.uploading { opacity: .6; pointer-events: none; }
.label { font-size: .9rem; font-weight: 600; color: #333; margin-bottom: 12px; }
img { width: 140px; height: 140px; object-fit: contain; border-radius: 8px; background: #f9f9f9; }
.hint { font-size: .75rem; color: #999; margin-top: 10px; }
.status { font-size: .8rem; margin-top: 8px; font-weight: 500; min-height: 1.2em; }
.ok { color: #16a34a; }
.err { color: #dc2626; }
input { display: none; }
.overlay { position: absolute; inset: 0; background: rgba(37,99,235,.08); display: flex;
  align-items: center; justify-content: center; opacity: 0; transition: opacity .2s; }
.card:hover .overlay { opacity: 1; }
.overlay span { background: #2563eb; color: #fff; padding: 8px 16px; border-radius: 6px; font-size: .85rem; }
</style>
</head>
<body>
<div class="container">
<h1>QR Code Manager</h1>
<div class="grid" id="grid"></div>
</div>
<script>
const token = localStorage.getItem('qr_token') || prompt('Enter token:')
if (!token) {
  document.body.innerHTML = '<p style="padding:40px;text-align:center">Access denied</p>'
} else {
  localStorage.setItem('qr_token', token)
}

const slots = ${JSON.stringify(SLOTS)}
const uploadUrl = new URL('upload', window.location.href).pathname
const grid = document.getElementById('grid')
slots.forEach(slot => {
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML =
    '<div class="label">' + slot.label + '</div>' +
    '<img src="/packages/qr-assets/' + slot.file + '?t=' + Date.now() + '" alt="' + slot.label + '">' +
    '<div class="hint">click to replace</div>' +
    '<div class="status" id="status-' + slot.key + '"></div>' +
    '<input type="file" accept="image/*" id="input-' + slot.key + '">' +
    '<div class="overlay"><span>click to upload</span></div>'
  card.addEventListener('click', function(e) {
    if (e.target.tagName === 'INPUT') return
    document.getElementById('input-' + slot.key).click()
  })
  card.querySelector('input').addEventListener('change', function(e) {
    var file = e.target.files[0]
    if (!file) return
    upload(slot, file, card)
    e.target.value = ''
  })
  grid.appendChild(card)
})

function upload(slot, file, card) {
  var status = document.getElementById('status-' + slot.key)
  card.classList.add('uploading')
  status.className = 'status'
  status.textContent = 'uploading...'
  var form = new FormData()
  form.append('file', file, slot.file)
  fetch(uploadUrl + '?token=' + encodeURIComponent(token) + '&name=' + slot.file, { method: 'POST', body: form })
    .then(function(res) { return res.json() })
    .then(function(j) {
      if (j.ok) {
        status.className = 'status ok'
        status.textContent = 'updated!'
        card.querySelector('img').src = '/packages/qr-assets/' + slot.file + '?t=' + Date.now()
      } else {
        status.className = 'status err'
        status.textContent = j.error
      }
      card.classList.remove('uploading')
      setTimeout(function() { status.textContent = '' }, 3000)
    })
    .catch(function(e) {
      status.className = 'status err'
      status.textContent = e.message
      card.classList.remove('uploading')
    })
}
</script>
</body>
</html>`
}

const ALLOWED = new Set(SLOTS.map((s) => s.file))

function isAdminIndex(pathname) {
  return pathname === '/' || pathname === BASE_PATH || pathname === BASE_PATH + '/'
}

function isUpload(pathname) {
  return pathname === '/upload' || pathname === BASE_PATH + '/upload'
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function parseMultipart(req, callback) {
  const contentType = req.headers['content-type'] || ''
  const boundary = contentType.split('boundary=')[1]
  if (!boundary) {
    callback(new Error('missing multipart boundary'))
    return
  }
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const parts = body.toString('binary').split('--' + boundary)
    for (const part of parts) {
      if (!part.includes('filename=')) continue
      const headerEnd = part.indexOf('\r\n\r\n')
      if (headerEnd < 0) continue
      let content = part.slice(headerEnd + 4)
      if (content.endsWith('\r\n')) content = content.slice(0, -2)
      callback(null, Buffer.from(content, 'binary'))
      return
    }
    callback(new Error('no file found'))
  })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (req.method === 'GET' && isAdminIndex(url.pathname)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html())
    return
  }

  if (req.method === 'POST' && isUpload(url.pathname)) {
    if (url.searchParams.get('token') !== readToken()) {
      writeJson(res, 403, { ok: false, error: 'invalid token' })
      return
    }
    const name = url.searchParams.get('name')
    if (!ALLOWED.has(name)) {
      writeJson(res, 400, { ok: false, error: 'invalid filename' })
      return
    }
    parseMultipart(req, (err, buffer) => {
      if (err) {
        writeJson(res, 400, { ok: false, error: err.message })
        return
      }
      fs.mkdirSync(UPLOAD_DIR, { recursive: true })
      const dest = path.join(UPLOAD_DIR, name)
      fs.writeFileSync(dest, buffer)
      writeJson(res, 200, { ok: true, size: buffer.length })
    })
    return
  }

  res.writeHead(404)
  res.end('Not Found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('QR upload server on http://127.0.0.1:' + PORT)
})
