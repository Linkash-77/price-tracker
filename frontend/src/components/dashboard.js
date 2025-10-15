import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
const API = import.meta.env.VITE_BACKEND_URL;


function Dashboard() {
  const [url, setUrl] = useState('');
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState(null);

  const token = localStorage.getItem('token');
  const headers = useMemo(() => ({ Authorization: token }), [token]);

  // Fetch products
  const fetchProducts = useCallback(async () => {
    try {
      const res = await axios.get('http://localhost:3001/products', { headers });
      setProducts(res.data);
    } catch (err) {
      console.error(err);
      setMessage('❌ Could not fetch products');
      setTimeout(() => setMessage(null), 3000);
    }
  }, [headers]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Add product
  const addProduct = async () => {
    try {
      await axios.post('http://localhost:3001/product', { url }, { headers });
      setUrl('');
      fetchProducts();
      setMessage('✅ Product added — confirmation email sent to your login email.');
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      setMessage(err.response?.data?.error || '❌ Error adding product');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // Check price
  const checkPrice = async (id) => {
    try {
      await axios.post(`http://localhost:3001/check/${id}`, {}, { headers });
      fetchProducts();
      setMessage('📩 Email sent to your login email with the latest price.');
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      setMessage(err.response?.data?.error || '❌ Error checking price');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // Delete product
  const deleteProduct = async (id) => {
    try {
      await axios.delete(`http://localhost:3001/product/${id}`, { headers });
      // Remove from local state so UI updates immediately
      setProducts(prev => prev.filter(p => p.id !== id));
      setMessage('🗑️ Product deleted successfully');
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage(err.response?.data?.error || '❌ Error deleting product');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>📊 Price Tracker Dashboard</h2>

      {message && (
        <div style={{ marginBottom: 15, padding: 10, backgroundColor: '#f8f8f8', borderRadius: 6 }}>
          {message}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <input
          placeholder="Enter product URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ padding: 8, width: 350, marginRight: 10 }}
        />
        <button onClick={addProduct} style={{ padding: '8px 12px' }}>➕ Add Product</button>
      </div>

      <div>
        {products.length === 0 ? (
          <p>No products added yet.</p>
        ) : (
          products.map((p) => (
            <div key={p.id} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, marginBottom: 10 }}>
              <p><strong>URL:</strong> {p.url}</p>
              <p><strong>Current Price:</strong> ₹{p.price}</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => checkPrice(p.id)} style={{ padding: '6px 10px' }}>🔍 Check Price</button>
                <button onClick={() => deleteProduct(p.id)} style={{ padding: '6px 10px', backgroundColor: '#ff4d4d', color: '#fff' }}>🗑️ Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Dashboard;
