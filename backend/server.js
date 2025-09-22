require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const axios = require('axios');
const cheerio = require('cheerio');

// ===================
// Initialize App
// ===================
const app = express();
app.use(express.json());
app.use(cors());

// ===================
// Supabase client - uses env vars SUPABASE_URL & SUPABASE_ANON_KEY
// ===================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ===================
// Default price selector
// ===================
const DEFAULT_SELECTOR = 'span.a-price-whole';

// ===================
// Helper: fetch price (basic scraping)
// ===================
async function fetchPrice(url) {
  const { data } = await axios.get(url, { timeout: 15000 });
  const $ = cheerio.load(data);
  const priceText = $(DEFAULT_SELECTOR).first().text() || '';
  const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || null;
  if (price === null) throw new Error('Could not parse price from page');
  return price;
}

// ===================
// Helper: send email (SMTP via Gmail)
// ===================
async function sendEmail(to, subject, text, html = null) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });

  await transporter.sendMail({
    from: `"Price Tracker" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html: html || text
  });
}

// ===================
// Middleware: auth (expects Authorization header = token)
// ===================
function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Unauthorized: token missing' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ===================
// AUTH ROUTES
// ===================

// Signup
app.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    // prevent duplicate signups
    const { data: existing } = await supabase.from('users').select('id').eq('email', email).limit(1).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert([{ email, password: hashedPassword }])
      .select();

    if (error) throw error;

    const token = jwt.sign({ id: data[0].id }, process.env.JWT_SECRET);
    res.json({ token });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Signup failed' });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) return res.status(400).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, data.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: data.id }, process.env.JWT_SECRET);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===================
// PRODUCT ROUTES
// ===================

// Add product (authenticated)
app.post('/product', authMiddleware, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const price = await fetchPrice(url);

    const { data: productData, error: productError } = await supabase
      .from('products')
      .insert([{ url, price, user_id: req.userId }])
      .select();

    if (productError) throw productError;

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('email')
      .eq('id', req.userId)
      .single();

    if (userError || !userData) throw new Error('User email not found');

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 16px;">
        <h2>✅ Product Added Successfully</h2>
        <p>We’ve started tracking this product for you.</p>
        <p><strong>Current Price:</strong> ₹${price}</p>
        <p><a href="${url}" target="_blank">🔗 View Product</a></p>
        <p>We’ll notify you if the price drops below this value.</p>
      </div>
    `;

    await sendEmail(userData.email, '✅ Product Added Successfully', `Product added. Current price: ₹${price}`, html);

    res.json({
      message: 'Product added and confirmation email sent',
      product: productData[0]
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to add product' });
  }
});

// Get user products
app.get('/products', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('user_id', req.userId);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check price & notify (authenticated)
app.post('/check/:productId', authMiddleware, async (req, res) => {
  try {
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.productId)
      .single();

    if (productError || !product) return res.status(404).json({ error: 'Product not found' });

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('email')
      .eq('id', req.userId)
      .single();

    if (userError || !userData) throw new Error('User not found');

    const currentPrice = await fetchPrice(product.url);

    let subject, text, html;
    if (currentPrice < product.price) {
      subject = '📉 Price Drop Alert!';
      text = `Price dropped to ₹${currentPrice} for ${product.url}`;
      html = `
        <div style="font-family: Arial, sans-serif; padding: 16px;">
          <h2>📉 Price Drop Alert!</h2>
          <p>Your tracked product has dropped in price.</p>
          <p><strong>New Price:</strong> ₹${currentPrice}</p>
          <p><a href="${product.url}" target="_blank">🔗 View Product</a></p>
        </div>
      `;
    } else {
      subject = 'ℹ️ Current Price Update';
      text = `Current price is ₹${currentPrice} for ${product.url}`;
      html = `
        <div style="font-family: Arial, sans-serif; padding: 16px;">
          <h2>ℹ️ Current Price Update</h2>
          <p>Your tracked product’s price is checked.</p>
          <p><strong>Current Price:</strong> ₹${currentPrice}</p>
          <p><a href="${product.url}" target="_blank">🔗 View Product</a></p>
        </div>
      `;
    }

    await sendEmail(userData.email, subject, text, html);

    const { error: updateError } = await supabase
      .from('products')
      .update({ price: currentPrice })
      .eq('id', req.params.productId);

    if (updateError) throw updateError;

    res.json({ message: 'Price checked & email sent', currentPrice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete product (authenticated)
app.delete('/product/:productId', authMiddleware, async (req, res) => {
  try {
    const productId = req.params.productId;

    // Fetch the product first to confirm ownership
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .eq('user_id', req.userId) // ensure this product belongs to current user
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!product) {
      return res.status(404).json({ error: 'Product not found or not owned by user' });
    }

    // Delete the product
    const { data: deleted, error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('user_id', req.userId)
      .select();

    if (deleteError) throw deleteError;

    res.json({ message: '✅ Product deleted successfully', product: deleted[0] });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete product' });
  }
});



// ===================
// Start server (port 3001)
// ===================
const PORT = 3001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
