const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// --- Data directory setup ---
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BLOGS_DIR = path.join(DATA_DIR, 'blogs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(DATA_DIR);
ensureDir(BLOGS_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');

// --- Helpers ---
function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function userBlogsDir(username) {
  return path.join(BLOGS_DIR, username);
}

function blogDir(username, blogId) {
  return path.join(userBlogsDir(username), blogId);
}

function postDir(username, blogId, postId) {
  return path.join(blogDir(username, blogId), 'posts', postId);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data/blogs', (req, res, next) => {
  // Only serve image files from blog directories
  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(req.path)) return next();
  res.status(403).send('Forbidden');
}, express.static(BLOGS_DIR));

app.use(session({
  secret: 'blog-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.username) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// --- Multer for image uploads ---
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(postDir(req.session.username, req.params.blogId, req.params.postId), 'images');
    ensureDir(dir);
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/^image\//i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// --- Auth routes ---
app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });

  const users = readUsers();
  if (users[username]) return res.status(409).json({ error: 'Username taken' });

  const hash = await bcrypt.hash(password, 12);
  users[username] = { passwordHash: hash, createdAt: new Date().toISOString() };
  writeUsers(users);
  ensureDir(userBlogsDir(username));

  req.session.username = username;
  res.json({ username });
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  const user = users[username];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.username = username;
  res.json({ username });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/auth/me', (req, res) => {
  if (req.session.username) res.json({ username: req.session.username });
  else res.status(401).json({ error: 'Not authenticated' });
});

// --- Blog routes ---
app.get('/api/blogs', requireAuth, (req, res) => {
  const dir = userBlogsDir(req.session.username);
  if (!fs.existsSync(dir)) return res.json([]);

  const blogs = fs.readdirSync(dir)
    .filter(id => fs.existsSync(path.join(dir, id, 'meta.json')))
    .map(id => ({ id, ...readJson(path.join(dir, id, 'meta.json')) }));

  blogs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(blogs);
});

app.post('/api/blogs', requireAuth, (req, res) => {
  const { name, purpose } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const id = slugify(name) + '-' + Date.now();
  const dir = blogDir(req.session.username, id);
  ensureDir(path.join(dir, 'posts'));

  const meta = { name, purpose: purpose || '', createdAt: new Date().toISOString() };
  writeJson(path.join(dir, 'meta.json'), meta);

  res.status(201).json({ id, ...meta });
});

// --- Post routes ---
app.get('/api/blogs/:blogId/posts', requireAuth, (req, res) => {
  const postsDir = path.join(blogDir(req.session.username, req.params.blogId), 'posts');
  if (!fs.existsSync(postsDir)) return res.json([]);

  const posts = fs.readdirSync(postsDir)
    .filter(id => fs.existsSync(path.join(postsDir, id, 'meta.json')))
    .map(id => ({ id, ...readJson(path.join(postsDir, id, 'meta.json')) }));

  posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(posts);
});

app.post('/api/blogs/:blogId/posts', requireAuth, (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const id = uuidv4();
  const dir = postDir(req.session.username, req.params.blogId, id);
  ensureDir(path.join(dir, 'images'));

  const meta = { title, createdAt: new Date().toISOString() };
  writeJson(path.join(dir, 'meta.json'), meta);
  writeJson(path.join(dir, 'content.json'), []);

  res.status(201).json({ id, ...meta });
});

app.get('/api/blogs/:blogId/posts/:postId', requireAuth, (req, res) => {
  const dir = postDir(req.session.username, req.params.blogId, req.params.postId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });

  const meta = readJson(path.join(dir, 'meta.json'));
  const content = readJson(path.join(dir, 'content.json'));
  res.json({ id: req.params.postId, ...meta, content });
});

// Add a text block to a post
app.post('/api/blogs/:blogId/posts/:postId/blocks/text', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  const dir = postDir(req.session.username, req.params.blogId, req.params.postId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Post not found' });

  const contentFile = path.join(dir, 'content.json');
  const content = readJson(contentFile);
  const block = { id: uuidv4(), type: 'text', text };
  content.push(block);
  writeJson(contentFile, content);

  res.status(201).json(block);
});

// Upload an image block to a post
app.post('/api/blogs/:blogId/posts/:postId/blocks/image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });

  const dir = postDir(req.session.username, req.params.blogId, req.params.postId);
  const contentFile = path.join(dir, 'content.json');
  const content = readJson(contentFile);

  const imageUrl = `/data/blogs/${req.session.username}/${req.params.blogId}/posts/${req.params.postId}/images/${req.file.filename}`;
  const block = { id: uuidv4(), type: 'image', filename: req.file.filename, url: imageUrl };
  content.push(block);
  writeJson(contentFile, content);

  res.status(201).json(block);
});

// Delete a blog and all its contents
app.delete('/api/blogs/:blogId', requireAuth, (req, res) => {
  const dir = blogDir(req.session.username, req.params.blogId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

// Delete a post and all its contents
app.delete('/api/blogs/:blogId/posts/:postId', requireAuth, (req, res) => {
  const dir = postDir(req.session.username, req.params.blogId, req.params.postId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

// Update a text block
app.put('/api/blogs/:blogId/posts/:postId/blocks/:blockId', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  const dir = postDir(req.session.username, req.params.blogId, req.params.postId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Post not found' });

  const contentFile = path.join(dir, 'content.json');
  const content = readJson(contentFile);
  const block = content.find(b => b.id === req.params.blockId);
  if (!block || block.type !== 'text') return res.status(404).json({ error: 'Text block not found' });

  block.text = text;
  writeJson(contentFile, content);
  res.json(block);
});

// Replace an image block
app.put('/api/blogs/:blogId/posts/:postId/blocks/:blockId/image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image required' });

  const dir = postDir(req.session.username, req.params.blogId, req.params.postId);
  const contentFile = path.join(dir, 'content.json');
  const content = readJson(contentFile);
  const block = content.find(b => b.id === req.params.blockId);
  if (!block || block.type !== 'image') return res.status(404).json({ error: 'Image block not found' });

  if (block.filename) {
    const oldPath = path.join(dir, 'images', block.filename);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  block.filename = req.file.filename;
  block.url = `/data/blogs/${req.session.username}/${req.params.blogId}/posts/${req.params.postId}/images/${req.file.filename}`;
  writeJson(contentFile, content);
  res.json(block);
});

// Delete a block
app.delete('/api/blogs/:blogId/posts/:postId/blocks/:blockId', requireAuth, (req, res) => {
  const dir = postDir(req.session.username, req.params.blogId, req.params.postId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Post not found' });

  const contentFile = path.join(dir, 'content.json');
  const content = readJson(contentFile);
  const idx = content.findIndex(b => b.id === req.params.blockId);
  if (idx === -1) return res.status(404).json({ error: 'Block not found' });

  const [removed] = content.splice(idx, 1);
  if (removed.type === 'image' && removed.filename) {
    const imgPath = path.join(dir, 'images', removed.filename);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }

  writeJson(contentFile, content);
  res.json({ ok: true });
});

// --- Public viewing routes (no auth required) ---
app.get('/api/view/:username/:blogId', (req, res) => {
  const dir = blogDir(req.params.username, req.params.blogId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
  const meta = readJson(path.join(dir, 'meta.json'));
  res.json({ id: req.params.blogId, owner: req.params.username, ...meta });
});

app.get('/api/view/:username/:blogId/posts', (req, res) => {
  const postsDir = path.join(blogDir(req.params.username, req.params.blogId), 'posts');
  if (!fs.existsSync(postsDir)) return res.json([]);
  const posts = fs.readdirSync(postsDir)
    .filter(id => fs.existsSync(path.join(postsDir, id, 'meta.json')))
    .map(id => ({ id, ...readJson(path.join(postsDir, id, 'meta.json')) }));
  posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(posts);
});

app.get('/api/view/:username/:blogId/posts/:postId', (req, res) => {
  const dir = postDir(req.params.username, req.params.blogId, req.params.postId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
  const meta = readJson(path.join(dir, 'meta.json'));
  const content = readJson(path.join(dir, 'content.json'));
  res.json({ id: req.params.postId, ...meta, content });
});

app.listen(PORT, () => console.log(`Blog server running at http://localhost:${PORT}`));
