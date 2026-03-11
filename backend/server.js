const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ═══ CLOUDINARY CONFIG ═══
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ═══ CORS CONFIG ═══
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for now, tighten in production
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ═══ MONGODB CONNECTION ═══
let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
      heartbeatFrequencyMS: 10000,
    });
    isConnected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    setTimeout(connectDB, 5000);
  }
};

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected. Reconnecting...');
  isConnected = false;
  setTimeout(connectDB, 3000);
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB error:', err.message);
  isConnected = false;
});

connectDB();

// ═══ SCHEMAS ═══

// Admin Schema
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, default: 'Admin' },
  createdAt: { type: Date, default: Date.now },
});
const Admin = mongoose.model('Admin', adminSchema);

// Category Schema
const categorySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  lbl: { type: String, required: true },
  em: { type: String, default: '🛒' },
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});
const Category = mongoose.model('Category', categorySchema);

// Product Schema
const productSchema = new mongoose.Schema({
  cat: { type: String, required: true },
  nm: { type: String, required: true },
  sub: { type: String, default: '' },
  em: { type: String, default: '🛒' },
  bg: { type: String, default: '#c8a55a' },
  best: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  phone: { type: String, default: '01712345678' },
  img: { type: String, default: '' },
  imgPublicId: { type: String, default: '' },
  imgs: [{ type: String }],
  imgsPublicIds: [{ type: String }],
  desc: { type: String, default: '' },
  highlights: [{ type: String }],
  variants: [{
    lbl: String,
    p: Number,
    op: Number,
    disc: String,
  }],
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
const Product = mongoose.model('Product', productSchema);

// Order Schema
const orderSchema = new mongoose.Schema({
  orderNum: { type: String, required: true, unique: true },
  items: [{
    productId: String,
    nm: String,
    varLabel: String,
    qty: Number,
    cartPrice: Number,
    em: String,
    img: String,
  }],
  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    note: String,
  },
  delivery: {
    type: { type: String },
    charge: Number,
  },
  subtotal: Number,
  total: Number,
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
  statusHistory: [{
    status: String,
    note: String,
    time: { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
const Order = mongoose.model('Order', orderSchema);

// Hero Slide Schema
const heroSchema = new mongoose.Schema({
  title: String,
  subtitle: String,
  gradient: { type: String, default: 's1' },
  img: { type: String, default: '' },
  imgPublicId: { type: String, default: '' },
  ctaText: { type: String, default: '' },
  active: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
});
const Hero = mongoose.model('Hero', heroSchema);

// Settings Schema
const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
  updatedAt: { type: Date, default: Date.now },
});
const Settings = mongoose.model('Settings', settingsSchema);

// ═══ CLOUDINARY STORAGE ═══
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'asolgramer',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'fill', quality: 'auto' }],
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const thumbStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'asolgramer/thumbs',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }],
  },
});
const uploadThumb = multer({ storage: thumbStorage });

// ═══ AUTH MIDDLEWARE ═══
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'asolgramer_secret_2024');
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ═══ DB MIDDLEWARE ═══
const dbMiddleware = async (req, res, next) => {
  if (!isConnected) await connectDB();
  next();
};
app.use(dbMiddleware);

// ═══ KEEP ALIVE (Render free plan) ═══
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(async () => {
  try {
    const https = require('https');
    const http = require('http');
    const url = new URL(SELF_URL + '/api/health');
    const client = url.protocol === 'https:' ? https : http;
    client.get(url.href, (res) => {
      res.resume();
      console.log(`🏓 Keep-alive ping: ${res.statusCode}`);
    }).on('error', () => {});
  } catch {}
}, 14 * 60 * 1000); // every 14 minutes

// ═══ ROUTES ═══

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    db: isConnected ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    time: new Date().toISOString(),
  });
});

// ─── AUTH ───
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    let admin = await Admin.findOne({ username });

    // Auto-create default admin on first run
    if (!admin && username === 'admin') {
      const hashed = await bcrypt.hash('admin123', 10);
      admin = await Admin.create({ username: 'admin', password: hashed, name: 'Super Admin' });
    }

    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: admin._id, username: admin.username, name: admin.name },
      process.env.JWT_SECRET || 'asolgramer_secret_2024',
      { expiresIn: '7d' }
    );

    res.json({ token, admin: { username: admin.username, name: admin.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const admin = await Admin.findById(req.admin.id);
    const valid = await bcrypt.compare(currentPassword, admin.password);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PRODUCTS ───
app.get('/api/products', async (req, res) => {
  try {
    const { cat, best, active = 'true', limit, page = 1 } = req.query;
    const filter = {};
    if (active !== 'all') filter.active = active === 'true';
    if (cat && cat !== 'all') filter.cat = cat;
    if (best === 'true') filter.best = true;

    const total = await Product.countDocuments(filter);
    let query = Product.find(filter).sort({ order: 1, createdAt: -1 });
    if (limit) {
      const lim = parseInt(limit);
      const skip = (parseInt(page) - 1) * lim;
      query = query.skip(skip).limit(lim);
    }
    const products = await query;
    res.json({ products, total, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', authMiddleware, async (req, res) => {
  try {
    const product = await Product.create({ ...req.body, updatedAt: new Date() });
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    // Delete images from cloudinary
    if (product.imgPublicId) {
      await cloudinary.uploader.destroy(product.imgPublicId).catch(() => {});
    }
    for (const pid of (product.imgsPublicIds || [])) {
      await cloudinary.uploader.destroy(pid).catch(() => {});
    }
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle product active
app.patch('/api/products/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    product.active = !product.active;
    product.updatedAt = new Date();
    await product.save();
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle best seller
app.patch('/api/products/:id/best', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    product.best = !product.best;
    product.updatedAt = new Date();
    await product.save();
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── IMAGE UPLOAD ───
app.post('/api/upload/product-image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    res.json({
      url: req.file.path,
      publicId: req.file.filename,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload/product-thumbs', authMiddleware, uploadThumb.array('images', 4), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No images uploaded' });
    const results = req.files.map(f => ({ url: f.path, publicId: f.filename }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/upload/:publicId', authMiddleware, async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    await cloudinary.uploader.destroy(publicId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CATEGORIES ───
app.get('/api/categories', async (req, res) => {
  try {
    const cats = await Category.find({ active: true }).sort({ order: 1 });
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories/all', authMiddleware, async (req, res) => {
  try {
    const cats = await Category.find().sort({ order: 1 });
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', authMiddleware, async (req, res) => {
  try {
    const cat = await Category.create(req.body);
    res.status(201).json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categories/:id', authMiddleware, async (req, res) => {
  try {
    const cat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', authMiddleware, async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle category active/inactive
app.patch('/api/categories/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    cat.active = !cat.active;
    await cat.save();
    res.json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ORDERS ───
app.post('/api/orders', async (req, res) => {
  try {
    const { items, customer, delivery, subtotal, total } = req.body;
    if (!customer?.name || !customer?.phone || !customer?.address) {
      return res.status(400).json({ error: 'Customer info required' });
    }
    const orderNum = 'GMJ-' + Date.now().toString().slice(-8);
    const order = await Order.create({
      orderNum, items, customer, delivery, subtotal, total,
      statusHistory: [{ status: 'pending', note: 'Order placed' }],
    });
    res.status(201).json({ orderNum: order.orderNum, id: order._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (search) {
      filter.$or = [
        { orderNum: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } },
        { 'customer.phone': { $regex: search, $options: 'i' } },
      ];
    }
    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    res.json({ orders, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:id', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/orders/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status, note } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    order.status = status;
    order.statusHistory.push({ status, note: note || '' });
    order.updatedAt = new Date();
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HERO SLIDES ───
app.get('/api/hero', async (req, res) => {
  try {
    const slides = await Hero.find({ active: true }).sort({ order: 1 });
    res.json(slides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hero/all', authMiddleware, async (req, res) => {
  try {
    const slides = await Hero.find().sort({ order: 1 });
    res.json(slides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hero', authMiddleware, async (req, res) => {
  try {
    const slide = await Hero.create(req.body);
    res.status(201).json(slide);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/hero/:id', authMiddleware, async (req, res) => {
  try {
    const slide = await Hero.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(slide);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/hero/:id', authMiddleware, async (req, res) => {
  try {
    await Hero.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SETTINGS ───
app.get('/api/settings', authMiddleware, async (req, res) => {
  try {
    const settings = await Settings.find();
    const obj = {};
    settings.forEach(s => { obj[s.key] = s.value; });
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', authMiddleware, async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await Settings.findOneAndUpdate({ key }, { key, value, updatedAt: new Date() }, { upsert: true });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── PUBLIC PAGE ENDPOINTS ───
app.get("/api/pages/about", async (req, res) => {
  try {
    const s = await Settings.findOne({ key: "aboutPage" });
    res.json(s ? s.value : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/pages/contact", async (req, res) => {
  try {
    const s = await Settings.findOne({ key: "contactPage" });
    res.json(s ? s.value : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/pages/products", async (req, res) => {
  try {
    const { cat, page = 1, limit = 24, search } = req.query;
    const filter = { active: true };
    if (cat) filter.cat = cat;
    if (search) filter["$or"] = [{ nm: { "$regex": search, "$options": "i" } }, { sub: { "$regex": search, "$options": "i" } }];
    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter).sort({ createdAt: -1 }).skip((parseInt(page) - 1) * parseInt(limit)).limit(parseInt(limit));
    const cats = await Category.find({ active: true }).sort({ order: 1 });
    res.json({ products, total, pages: Math.ceil(total / parseInt(limit)), categories: cats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/public/settings", async (req, res) => {
  try {
    const settings = await Settings.find();
    const obj = {};
    settings.forEach(s => { if (!["aboutPage","contactPage"].includes(s.key)) obj[s.key] = s.value; });
    res.json(obj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// ─── DASHBOARD STATS ───
app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
  try {
    const [totalProducts, totalOrders, pendingOrders, deliveredOrders] = await Promise.all([
      Product.countDocuments({ active: true }),
      Order.countDocuments(),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: 'delivered' }),
    ]);

    const revenue = await Order.aggregate([
      { $match: { status: { $in: ['delivered', 'shipped'] } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);

    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(5);

    // Monthly revenue last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyData = await Order.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo }, status: { $ne: 'cancelled' } } },
      { $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        revenue: { $sum: '$total' },
        count: { $sum: 1 },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Category distribution
    const catDist = await Product.aggregate([
      { $group: { _id: '$cat', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      totalProducts,
      totalOrders,
      pendingOrders,
      deliveredOrders,
      totalRevenue: revenue[0]?.total || 0,
      recentOrders,
      monthlyData,
      catDist,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SEED INITIAL DATA ───
app.post('/api/seed', authMiddleware, async (req, res) => {
  try {
    const { force } = req.body;
    // Seed categories if empty (or forced)
    const catCount = await Category.countDocuments();
    if (catCount === 0 || force) {
      if (force) await Category.deleteMany({});
      await Category.insertMany([
        { id: 'মিষ্টি',   lbl: 'মিষ্টি',   em: '🍬', order: 1, active: true },
        { id: 'দই',       lbl: 'দই',       em: '🥛', order: 2, active: true },
        { id: 'মিঠাই',   lbl: 'মিঠাই',   em: '🍮', order: 3, active: true },
        { id: 'তৈল',     lbl: 'তৈল',     em: '🫙', order: 4, active: true },
        { id: 'বোরহানী', lbl: 'বোরহানী', em: '🥤', order: 5, active: true },
        { id: 'রশমালাই', lbl: 'রশমালাই', em: '🍨', order: 6, active: true },
      ]);
    }

    // Seed products if empty (or forced)
    const prodCount = await Product.countDocuments();
    if (prodCount === 0 || force) {
      if (force) await Product.deleteMany({});
      await Product.insertMany([
        // ── মিষ্টি (5) ──
        { cat: 'মিষ্টি', nm: 'রসগোল্লা', sub: 'তাজা ছানার রসগোল্লা', em: '🍬', bg: '#e8b4d0', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 150, op: 180, disc: '17%' }, { lbl: '১ কেজি', p: 280, op: 340, disc: '18%' }], order: 1 },
        { cat: 'মিষ্টি', nm: 'সন্দেশ',    sub: 'খাঁটি ছানার সন্দেশ',  em: '🍬', bg: '#f5d08a', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ গ্রাম', p: 120, op: 150, disc: '20%' }, { lbl: '৫০০ গ্রাম', p: 230, op: 280, disc: '18%' }], order: 2 },
        { cat: 'মিষ্টি', nm: 'কালোজাম',   sub: 'গাঢ় রঙের কালোজাম',   em: '🍬', bg: '#6b3a6b', best: false, active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 160, op: 200, disc: '20%' }], order: 3 },
        { cat: 'মিষ্টি', nm: 'চমচম',      sub: 'ঐতিহ্যবাহী মিষ্টি',  em: '🍬', bg: '#f0c080', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 200, op: 250, disc: '20%' }, { lbl: '১ কেজি', p: 380, op: 460, disc: '17%' }], order: 4 },
        { cat: 'মিষ্টি', nm: 'লাড্ডু',    sub: 'বেসনের খাঁটি লাড্ডু', em: '🍬', bg: '#e8a050', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ গ্রাম', p: 100, op: 130, disc: '23%' }, { lbl: '৫০০ গ্রাম', p: 190, op: 240, disc: '21%' }], order: 5 },

        // ── দই (5) ──
        { cat: 'দই', nm: 'মিষ্টি দই',     sub: 'মাটির পাতিলে তৈরি',   em: '🥛', bg: '#fffbe6', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '২৫০ গ্রাম', p: 60,  op: 80,  disc: '25%' }, { lbl: '৫০০ গ্রাম', p: 110, op: 140, disc: '21%' }], order: 1 },
        { cat: 'দই', nm: 'টক দই',          sub: 'প্রাকৃতিক টক দই',     em: '🥛', bg: '#f0f8ff', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ গ্রাম', p: 50,  op: 70,  disc: '29%' }, { lbl: '৫০০ গ্রাম', p: 90,  op: 120, disc: '25%' }], order: 2 },
        { cat: 'দই', nm: 'ঘরে তৈরি দই',   sub: 'সরিষার দই বিশেষ',     em: '🥛', bg: '#fef9e7', best: false, active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 100, op: 130, disc: '23%' }], order: 3 },
        { cat: 'দই', nm: 'ভাঁপা দই',      sub: 'বগুড়ার বিখ্যাত দই',   em: '🥛', bg: '#fdf2e9', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '২৫০ গ্রাম', p: 80,  op: 100, disc: '20%' }, { lbl: '৫০০ গ্রাম', p: 150, op: 190, disc: '21%' }], order: 4 },
        { cat: 'দই', nm: 'ফ্রুট দই',      sub: 'মৌসুমি ফলের দই',       em: '🥛', bg: '#e8f8f5', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ গ্রাম', p: 70,  op: 90,  disc: '22%' }], order: 5 },

        // ── মিঠাই (5) ──
        { cat: 'মিঠাই', nm: 'খেজুর গুড়',   sub: 'খাঁটি খেজুর গুড়',   em: '🍮', bg: '#8b4513', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 120, op: 150, disc: '20%' }, { lbl: '১ কেজি', p: 220, op: 280, disc: '21%' }], order: 1 },
        { cat: 'মিঠাই', nm: 'আখের গুড়',    sub: 'প্রাকৃতিক আখের গুড়', em: '🍮', bg: '#a0522d', best: false, active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 90,  op: 120, disc: '25%' }, { lbl: '১ কেজি', p: 170, op: 220, disc: '23%' }], order: 2 },
        { cat: 'মিঠাই', nm: 'তালের মিঠাই', sub: 'তালের রস থেকে তৈরি',  em: '🍮', bg: '#cd853f', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ গ্রাম', p: 80,  op: 100, disc: '20%' }], order: 3 },
        { cat: 'মিঠাই', nm: 'নলেন গুড়',   sub: 'শীতকালীন বিশেষ গুড়', em: '🍮', bg: '#b8860b', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 150, op: 200, disc: '25%' }, { lbl: '১ কেজি', p: 280, op: 370, disc: '24%' }], order: 4 },
        { cat: 'মিঠাই', nm: 'পাটালি গুড়', sub: 'শক্ত পাটালি গুড়',    em: '🍮', bg: '#d2691e', best: false, active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 130, op: 170, disc: '24%' }], order: 5 },

        // ── তৈল (5) ──
        { cat: 'তৈল', nm: 'সরিষার তৈল',   sub: 'ঘানি ভাঙা খাঁটি সরিষার তৈল', em: '🫙', bg: '#ffd700', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '৫০০ মি.লি.', p: 160, op: 200, disc: '20%' }, { lbl: '১ লিটার', p: 300, op: 380, disc: '21%' }], order: 1 },
        { cat: 'তৈল', nm: 'নারিকেল তৈল', sub: 'ভার্জিন নারিকেল তৈল',         em: '🫙', bg: '#f5f5dc', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ মি.লি.', p: 180, op: 220, disc: '18%' }, { lbl: '৫০০ মি.লি.', p: 340, op: 420, disc: '19%' }], order: 2 },
        { cat: 'তৈল', nm: 'কালোজিরা তৈল', sub: 'বিশুদ্ধ কালোজিরার তৈল',     em: '🫙', bg: '#2f2f2f', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '১০০ মি.লি.', p: 150, op: 190, disc: '21%' }, { lbl: '২৫০ মি.লি.', p: 340, op: 430, disc: '21%' }], order: 3 },
        { cat: 'তৈল', nm: 'তিলের তৈল',   sub: 'তিল ঘানি থেকে তৈরি',          em: '🫙', bg: '#c8a55a', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ মি.লি.', p: 200, op: 250, disc: '20%' }], order: 4 },
        { cat: 'তৈল', nm: 'আদার তৈল',    sub: 'আদা থেকে প্রস্তুত',            em: '🫙', bg: '#c8a040', best: false, active: true, phone: '01712345678', variants: [{ lbl: '১০০ মি.লি.', p: 120, op: 150, disc: '20%' }], order: 5 },

        // ── বোরহানী (5) ──
        { cat: 'বোরহানী', nm: 'পুদিনা বোরহানী',   sub: 'তাজা পুদিনা পাতার বোরহানী', em: '🥤', bg: '#2ecc71', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '২৫০ মি.লি.', p: 50, op: 70, disc: '29%' }, { lbl: '৫০০ মি.লি.', p: 90, op: 120, disc: '25%' }], order: 1 },
        { cat: 'বোরহানী', nm: 'ধনিয়া বোরহানী',   sub: 'ধনিয়া পাতায় তৈরি বোরহানী',  em: '🥤', bg: '#27ae60', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ মি.লি.', p: 50, op: 70, disc: '29%' }], order: 2 },
        { cat: 'বোরহানী', nm: 'মশলা বোরহানী',     sub: 'বিশেষ মশলার মিশ্রণে',          em: '🥤', bg: '#1abc9c', best: false, active: true, phone: '01712345678', variants: [{ lbl: '৫০০ মি.লি.', p: 100, op: 130, disc: '23%' }, { lbl: '১ লিটার', p: 185, op: 240, disc: '23%' }], order: 3 },
        { cat: 'বোরহানী', nm: 'রোজ বোরহানী',      sub: 'গোলাপজলের সুগন্ধে',           em: '🥤', bg: '#ff69b4', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '২৫০ মি.লি.', p: 60, op: 80, disc: '25%' }], order: 4 },
        { cat: 'বোরহানী', nm: 'জিরা বোরহানী',     sub: 'জিরার স্বাদে ভরপুর',            em: '🥤', bg: '#16a085', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ মি.লি.', p: 45, op: 60, disc: '25%' }, { lbl: '৫০০ মি.লি.', p: 85, op: 110, disc: '23%' }], order: 5 },

        // ── রশমালাই (5) ──
        { cat: 'রশমালাই', nm: 'ক্লাসিক রশমালাই',  sub: 'ঘন দুধের ক্লাসিক রশমালাই', em: '🍨', bg: '#fff0e6', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 250, op: 300, disc: '17%' }, { lbl: '১ কেজি', p: 480, op: 580, disc: '17%' }], order: 1 },
        { cat: 'রশমালাই', nm: 'কেসার রশমালাই',    sub: 'জাফরান মিশ্রিত বিশেষ',      em: '🍨', bg: '#ffeaa7', best: false, active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 320, op: 380, disc: '16%' }], order: 2 },
        { cat: 'রশমালাই', nm: 'চকলেট রশমালাই',   sub: 'চকলেট ফ্লেভারের রশমালাই', em: '🍨', bg: '#d35400', best: false, active: true, phone: '01712345678', variants: [{ lbl: '৫০০ গ্রাম', p: 300, op: 360, disc: '17%' }], order: 3 },
        { cat: 'রশমালাই', nm: 'এলাচি রশমালাই',   sub: 'এলাচের সুগন্ধে ভরা',        em: '🍨', bg: '#f8e6ff', best: true,  active: true, phone: '01712345678', variants: [{ lbl: '২৫০ গ্রাম', p: 140, op: 170, disc: '18%' }, { lbl: '৫০০ গ্রাম', p: 260, op: 320, disc: '19%' }], order: 4 },
        { cat: 'রশমালাই', nm: 'মিনি রশমালাই',    sub: 'ছোট ছোট মজাদার টুকরো',      em: '🍨', bg: '#ffeef8', best: false, active: true, phone: '01712345678', variants: [{ lbl: '২৫০ গ্রাম', p: 120, op: 150, disc: '20%' }, { lbl: '৫০০ গ্রাম', p: 220, op: 280, disc: '21%' }], order: 5 },
      ]);
    }

    // Seed hero if empty (or forced)
    const heroCount = await Hero.countDocuments();
    if (heroCount === 0 || force) {
      if (force) await Hero.deleteMany({});
      await Hero.insertMany([
        { title: 'গ্রামীণ সতেজতা ও স্বাদের আসল স্বাদ', subtitle: 'বিশুদ্ধ গ্রামীণ পণ্য এখন আপনার দরজায়', gradient: 's1', order: 1 },
        { title: 'বিশুদ্ধ সরিষার মধু সরাসরি মৌমাছির চাকা থেকে', subtitle: 'প্রকৃতির সেরা উপহার আপনার দোরগোড়ায়', gradient: 's2', order: 2 },
        { title: 'তাজা দুধের তৈরি দই ও মিষ্টান্ন', subtitle: 'খাঁটি গ্রামীণ স্বাদ, আজই অর্ডার করুন', gradient: 's3', order: 3 },
      ]);
    }

    res.json({ success: true, message: 'Seed completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 404 ───
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── ERROR HANDLER ───
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START ───
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;