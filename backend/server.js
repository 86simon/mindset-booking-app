// server.js

// 1. Impor semua package yang dibutuhkan
const express = require('express');
const { MongoClient } = require('mongodb');
const midtransClient = require('midtrans-client');
const cors = require('cors');
require('dotenv').config(); // Memuat variabel dari file .env

// 2. Inisialisasi aplikasi Express
const app = express();
app.use(cors()); // Izinkan akses dari domain lain
app.use(express.json()); // Izinkan server membaca body JSON

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
        db = client.db("mindset_psychology"); // Anda bisa ganti nama database ini jika mau
        console.log("Berhasil terhubung ke MongoDB");
    } catch (err) {
        console.error("Gagal terhubung ke MongoDB", err);
    }
}

// 4. Membuat API Endpoints

// Endpoint untuk membuat transaksi dan mendapatkan token Midtrans
app.post('/api/buat-transaksi', async (req, res) => {
    try {
        const bookingData = req.body;
        const orderId = 'MINDSET-' + Date.now();

        // Simpan data awal ke MongoDB dengan status "Menunggu Pembayaran"
        const collection = db.collection('bookings');
        await collection.insertOne({
            ...bookingData,
            orderId: orderId,
            status: 'Menunggu Pembayaran',
            createdAt: new Date()
        });

        // Siapkan parameter untuk Midtrans
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

        // Dapatkan token dari Midtrans
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
        const notificationJson = req.body;
        const statusResponse = await snap.transaction.notification(notificationJson);
        
        let order_id = statusResponse.order_id;
        let transaction_status = statusResponse.transaction_status;
        let fraud_status = statusResponse.fraud_status;

        console.log(`Transaksi ID ${order_id}: ${transaction_status}`);

        // Update database berdasarkan status pembayaran
        const collection = db.collection('bookings');
        if (transaction_status == 'capture' || transaction_status == 'settlement') {
            // TODO: Tambahkan logika pengiriman email SendGrid di sini
            await collection.updateOne({ orderId: order_id }, { $set: { status: 'Lunas' } });
        }
        
        res.status(200).send("OK");
    } catch (error) {
        console.error("Error notifikasi:", error);
        res.status(500).send("Internal Server Error");
    }
});

// Endpoint untuk mengambil semua data booking (untuk dashboard admin)
app.get('/api/get-bookings', async (req, res) => {
    try {
        const collection = db.collection('bookings');
        const bookings = await collection.find({}).sort({ createdAt: -1 }).toArray();
        res.json(bookings);
    } catch (error) {
        console.error("Error mengambil bookings:", error);
        res.status(500).send("Internal Server Error");
    }
});


// 5. Jalankan Server
const PORT = process.env.PORT || 3000;
// Perbaikan: Tambahkan '0.0.0.0' agar server mendengarkan koneksi dari luar VPS
app.listen(PORT, '0.0.0.0', () => {
    connectDB();
    console.log(`Server berjalan di port ${PORT} dan siap menerima koneksi dari mana saja.`);
});
