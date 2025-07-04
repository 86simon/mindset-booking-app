// server.js

// 1. Impor semua package yang dibutuhkan
const express = require('express');
const { MongoClient } = require('mongodb');
const midtransClient = require('midtrans-client');
const cors = require('cors');
require('dotenv').config();

// 2. Inisialisasi aplikasi Express
const app = express();

// --- PERBAIKAN CORS (Versi Disederhanakan) ---
// Mengizinkan semua koneksi dari mana saja. Ini lebih sederhana dan seringkali lebih andal.
app.use(cors());

app.use(express.json());

// 3. Konfigurasi Koneksi Database dan Midtrans
const mongoUri = process.env.MONGO_URI;
const client = new MongoClient(mongoUri);
let db;

// Inisialisasi Midtrans Snap
let snap = new midtransClient.Snap({
    isProduction: false, // Ganti ke true saat sudah di produksi
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
});

// Fungsi untuk konek ke database
async function connectDB() {
    try {
        await client.connect();
        db = client.db("mindset_psychology");
        console.log("Berhasil terhubung ke MongoDB");
    } catch (err) {
        console.error("Gagal terhubung ke MongoDB", err);
        // Hentikan proses jika tidak bisa konek ke DB
        process.exit(1);
    }
}

// 4. Membuat API Endpoints

// Endpoint untuk mengambil semua data booking (untuk dashboard admin)
app.get('/api/get-bookings', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).send("Database tidak terhubung.");
        }
        const collection = db.collection('bookings');
        const bookings = await collection.find({}).sort({ createdAt: -1 }).toArray();
        res.json(bookings);
    } catch (error) {
        console.error("Error mengambil bookings:", error);
        res.status(500).send("Internal Server Error");
    }
});

// Endpoint untuk membuat transaksi dan mendapatkan token Midtrans
app.post('/api/buat-transaksi', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).send("Database tidak terhubung.");
        }
        const bookingData = req.body;
        const orderId = 'MINDSET-' + Date.now();

        const collection = db.collection('bookings');
        await collection.insertOne({
            ...bookingData,
            orderId: orderId,
            status: 'Menunggu Pembayaran',
            createdAt: new Date()
        });

        let parameter = {
            "transaction_details": {
                "order_id": orderId,
                "gross_amount": bookingData.service.price
            },
            "item_details": [{
                "id": bookingData.service.id,
                "price": bookingData.service.price,
                "quantity": 1,
                "name": bookingData.service.name
            }],
            "customer_details": {
                "first_name": bookingData.userInfo.fullName.split(' ')[0],
                "last_name": bookingData.userInfo.fullName.split(' ').slice(1).join(' ') || bookingData.userInfo.fullName.split(' ')[0],
                "email": bookingData.userInfo.email,
                "phone": bookingData.userInfo.whatsapp
            }
        };

        const token = await snap.createTransactionToken(parameter);
        res.json({ token, orderId });

    } catch (error) {
        console.error("Error membuat transaksi:", error);
        res.status(500).send("Internal Server Error");
    }
});

// Endpoint untuk menerima notifikasi dari Midtrans (Webhook)
app.post('/api/notifikasi-midtrans', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).send("Database tidak terhubung.");
        }
        const notificationJson = req.body;
        const statusResponse = await snap.transaction.notification(notificationJson);
        
        let order_id = statusResponse.order_id;
        let transaction_status = statusResponse.transaction_status;

        console.log(`Transaksi ID ${order_id}: ${transaction_status}`);

        const collection = db.collection('bookings');
        if (transaction_status == 'capture' || transaction_status == 'settlement') {
            await collection.updateOne({ orderId: order_id }, { $set: { status: 'Lunas' } });
        }
        
        res.status(200).send("OK");
    } catch (error) {
        console.error("Error notifikasi:", error);
        res.status(500).send("Internal Server Error");
    }
});


// 5. Jalankan Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    connectDB();
    console.log(`Server berjalan di port ${PORT} dan siap menerima koneksi dari mana saja.`);
});
