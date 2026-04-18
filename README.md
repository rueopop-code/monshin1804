# monshinsupply API — V19

Backend API + SQLite สำหรับระบบแสดงสินค้า monshinsupply

## 📦 โครงสร้างไฟล์

```
monshin-api/
├── server.js          ← API หลัก (Express + SQLite)
├── package.json
├── Procfile           ← สำหรับ Railway/Render
├── .env.example       ← template config
├── .gitignore
└── public/
    └── index.html     ← Frontend (copy ไปใช้เอง)
```

## 🚀 Deploy บน Railway (ฟรี)

### ขั้นที่ 1 — สร้าง GitHub Repo
```bash
git init
git add .
git commit -m "init monshin api"
# สร้าง repo บน GitHub แล้ว push
git remote add origin https://github.com/YOUR_USERNAME/monshin-api.git
git push -u origin main
```

### ขั้นที่ 2 — Deploy บน Railway
1. ไปที่ [railway.app](https://railway.app) → Login ด้วย GitHub
2. กด **New Project** → **Deploy from GitHub repo**
3. เลือก repo `monshin-api`
4. Railway จะ detect Node.js และ deploy อัตโนมัติ

### ขั้นที่ 3 — ตั้งค่า Environment Variables
ใน Railway → Settings → Variables → เพิ่ม:

| Key | Value |
|-----|-------|
| `API_SECRET` | รหัสลับของคุณ เช่น `monshin-abc123xyz` |
| `DB_PATH` | `/app/data/products.db` |

### ขั้นที่ 4 — เปิด Volume (เก็บ DB ถาวร)
Railway → Storage → Add Volume:
- Mount path: `/app/data`

### ขั้นที่ 5 — เอา URL
Railway → Settings → Networking → Generate Domain
ได้ URL เช่น: `https://monshin-api-production.up.railway.app`

---

## 🖥 รัน Local (ทดสอบ)
```bash
npm install
cp .env.example .env
# แก้ .env ตามต้องการ
npm start
# หรือ
npm run dev
```

---

## 🔌 API Endpoints

### Public (ไม่ต้องมี secret)
| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/` | Health check |
| GET | `/api/products` | ดูสินค้าทั้งหมด |
| GET | `/api/products/:id` | ดูสินค้าชิ้นเดียว |
| GET | `/api/settings` | ดูข้อมูลร้าน |

### Protected (ต้องส่ง header: `x-api-secret: YOUR_SECRET`)
| Method | Path | คำอธิบาย |
|--------|------|----------|
| POST | `/api/products` | เพิ่มสินค้า (form/base64) |
| POST | `/api/products/bulk` | เพิ่มหลายสินค้าพร้อมกัน |
| PUT | `/api/products/:id` | แก้ไขสินค้า |
| DELETE | `/api/products/:id` | ลบสินค้า |
| DELETE | `/api/products` | ลบทั้งหมด |
| PUT | `/api/settings` | บันทึกข้อมูลร้าน |
| GET | `/api/export` | Export JSON backup |

### Query Parameters (GET /api/products)
- `?search=คำค้นหา`
- `?cat=หมวดหมู่`
- `?limit=100&offset=0`

---

## 💡 หมายเหตุ SQLite บน Railway

SQLite ต้องใช้ **Volume** เพื่อเก็บข้อมูลถาวร ถ้าไม่ mount volume ข้อมูลจะหายเมื่อ deploy ใหม่

สำหรับ scale ใหญ่ขึ้น แนะนำเปลี่ยนเป็น **PostgreSQL** (Railway มีให้ฟรีด้วย)
