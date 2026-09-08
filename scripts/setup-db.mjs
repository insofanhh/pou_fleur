import mysql from "mysql2/promise";
import { scryptSync, randomBytes } from "node:crypto";
const db = process.env.MYSQL_DATABASE || "fleur_store";
if (!/^[a-zA-Z0-9_]+$/.test(db)) throw Error("Invalid database name");
const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  multipleStatements: true,
});
await c.query(
  "CREATE DATABASE IF NOT EXISTS " +
    db +
    " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
);
await c.changeUser({ database: db });
await c.query(`
CREATE TABLE IF NOT EXISTS categories(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(120) NOT NULL,slug VARCHAR(160) UNIQUE NOT NULL,description TEXT);
CREATE TABLE IF NOT EXISTS products(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(160) NOT NULL,slug VARCHAR(180) UNIQUE NOT NULL,category_id INT NOT NULL,price INT NOT NULL,compare_price INT NULL,stock INT NOT NULL DEFAULT 0,image TEXT NOT NULL,description TEXT NOT NULL,flowers VARCHAR(255) NOT NULL,care TEXT NOT NULL,badge VARCHAR(60) DEFAULT '',active BOOLEAN DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(category_id) REFERENCES categories(id));
CREATE TABLE IF NOT EXISTS users(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100) NOT NULL,email VARCHAR(190) NOT NULL UNIQUE,password_hash VARCHAR(255) NOT NULL,phone VARCHAR(30) DEFAULT '',role ENUM('admin','manager','editor','support','customer') NOT NULL DEFAULT 'customer',birthday DATE NULL,address TEXT,marketing_consent BOOLEAN DEFAULT 0,active BOOLEAN DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token_hash CHAR(64) PRIMARY KEY,user_id INT NOT NULL,expires_at DATETIME NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS promotions(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(150) NOT NULL,code VARCHAR(40) UNIQUE NOT NULL,type ENUM('percent','fixed') DEFAULT 'percent',value INT NOT NULL,min_order INT DEFAULT 0,starts_at DATETIME NOT NULL,ends_at DATETIME NOT NULL,usage_limit INT DEFAULT 100,used INT DEFAULT 0,active BOOLEAN DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(id INT AUTO_INCREMENT PRIMARY KEY,reference VARCHAR(30) UNIQUE NOT NULL,user_id INT NULL,customer_name VARCHAR(100) NOT NULL,email VARCHAR(190) NOT NULL,phone VARCHAR(30) NOT NULL,address TEXT NOT NULL,recipient_name VARCHAR(100) NOT NULL,recipient_phone VARCHAR(30) NOT NULL,delivery_date DATE NOT NULL,delivery_slot VARCHAR(50) NOT NULL,message TEXT,notes TEXT,payment_method ENUM('cod','bank') NOT NULL,status ENUM('pending','confirmed','preparing','shipping','delivered','cancelled') NOT NULL DEFAULT 'pending',payment_status ENUM('unpaid','paid','refunded') NOT NULL DEFAULT 'unpaid',subtotal INT NOT NULL,discount INT NOT NULL DEFAULT 0,shipping INT NOT NULL DEFAULT 0,total INT NOT NULL,promotion_id INT NULL,idempotency_key VARCHAR(80) UNIQUE NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,FOREIGN KEY(promotion_id) REFERENCES promotions(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS order_items(id INT AUTO_INCREMENT PRIMARY KEY,order_id INT NOT NULL,product_id INT NOT NULL,product_name VARCHAR(160) NOT NULL,image TEXT NOT NULL,size VARCHAR(20) NOT NULL,quantity INT NOT NULL,price INT NOT NULL,FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS customers(id INT AUTO_INCREMENT PRIMARY KEY,email VARCHAR(190) UNIQUE NOT NULL,name VARCHAR(100) NOT NULL,phone VARCHAR(30) DEFAULT '',birthday DATE NULL,segment ENUM('new','loyal','vip','inactive') DEFAULT 'new',marketing_consent BOOLEAN DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS crm_notes(id INT AUTO_INCREMENT PRIMARY KEY,customer_id INT NOT NULL,author_id INT NOT NULL,content TEXT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,FOREIGN KEY(author_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS crm_tasks(id INT AUTO_INCREMENT PRIMARY KEY,customer_id INT NOT NULL,title VARCHAR(200) NOT NULL,due_date DATE NOT NULL,status ENUM('open','done') DEFAULT 'open',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS events(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(160) NOT NULL,description TEXT NOT NULL,starts_at DATE NOT NULL,ends_at DATE NOT NULL,active BOOLEAN DEFAULT 1);
CREATE TABLE IF NOT EXISTS posts(id INT AUTO_INCREMENT PRIMARY KEY,title VARCHAR(200) NOT NULL,slug VARCHAR(220) UNIQUE NOT NULL,excerpt TEXT NOT NULL,content TEXT NOT NULL,image TEXT NOT NULL,published BOOLEAN DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS inquiries(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100) NOT NULL,email VARCHAR(190) NOT NULL,message TEXT NOT NULL,status ENUM('new','resolved') DEFAULT 'new',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT NULL,action VARCHAR(80) NOT NULL,entity VARCHAR(60) NOT NULL,entity_id VARCHAR(60),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS login_attempts(attempt_key CHAR(64) PRIMARY KEY,attempts INT NOT NULL DEFAULT 1,expires_at DATETIME NOT NULL);
CREATE TABLE IF NOT EXISTS password_resets(token_hash CHAR(64) PRIMARY KEY,user_id INT NOT NULL,expires_at DATETIME NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
`);
const [[count]] = await c.query("SELECT COUNT(*) n FROM categories");
if (!count.n) {
  await c.query(
    "INSERT INTO categories(name,slug,description) VALUES ('Hoa bó','hoa-bo','Gửi trao một lời thương'),('Hoa bình','hoa-binh','Một góc nhà, một niềm vui'),('Hoa giỏ','hoa-gio','Những món quà đầy đặn'),('Hoa sự kiện','hoa-su-kien','Đánh dấu khoảnh khắc đặc biệt')",
  );
  const imgs = ["tulips", "roses", "daisies", "blush", "vase", "joy"];
  const ps = [
    [
      "Pure Poetry",
      "pure-poetry",
      2,
      690000,
      "Tulip trắng · 15 cành",
      "Được yêu thích",
    ],
    [
      "A Little Love",
      "a-little-love",
      1,
      590000,
      "Hồng phấn · 12 cành",
      "Bán chạy",
    ],
    ["Sunday Morning", "sunday-morning", 3, 450000, "Cúc trắng · Lá xanh", ""],
    ["Blush Notes", "blush-notes", 1, 790000, "Hồng pastel · 20 cành", "Mới"],
    [
      "Quiet Moments",
      "quiet-moments",
      2,
      890000,
      "Tulip trắng · Bình thủy tinh",
      "",
    ],
    [
      "Everyday Joy",
      "everyday-joy",
      4,
      1290000,
      "Cúc trắng · Thiết kế tự nhiên",
      "Theo mùa",
    ],
  ];
  for (let i = 0; i < ps.length; i++) {
    const [name, slug, cat, price, flowers, badge] = ps[i];
    await c.execute(
      "INSERT INTO products(name,slug,category_id,price,stock,image,description,flowers,care,badge) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [
        name,
        slug,
        cat,
        price,
        30,
        "/images/" + imgs[i] + ".jpg",
        "Một thiết kế nhẹ nhàng dành cho những cảm xúc chân thành. Từng cành hoa được florist lựa chọn và sắp đặt thủ công trong ngày, đi cùng giấy gói tối giản và thiệp viết tay theo lời nhắn của bạn. Hoa có thể thay đổi nhẹ theo mùa; Fleur sẽ liên hệ trước nếu cần thay thế.",
        flowers,
        "Cắt chéo gốc 1–2 cm và thay nước mỗi ngày. Đặt hoa ở nơi thoáng mát, tránh nắng trực tiếp và trái cây chín. Bỏ lá ngập nước để hoa tươi lâu hơn.",
        badge,
      ],
    );
  }
  await c.query(
    "INSERT INTO promotions(name,code,type,value,min_order,starts_at,ends_at) VALUES ('Lời chào từ Fleur','HELLOFLEUR','percent',10,400000,NOW(),DATE_ADD(NOW(),INTERVAL 1 YEAR))",
  );
  await c.query(
    "INSERT INTO events(name,description,starts_at,ends_at) VALUES ('Everyday Beauty','Những thiết kế hoa dành cho ngày bình thường trở nên đặc biệt. Tặng hoa cho bản thân, cho một người thương, hay đơn giản để ngôi nhà thêm chút dịu dàng.',CURDATE(),DATE_ADD(CURDATE(),INTERVAL 90 DAY)),('Một ngày dành cho nàng','Bộ sưu tập hoa tôn vinh những người phụ nữ bạn yêu thương. Đặt hoa sớm và ghi lại lời nhắn riêng của bạn.','2026-10-01','2026-10-20')",
  );
  await c.execute(
    "INSERT INTO posts(title,slug,excerpt,content,image,published) VALUES(?,?,?,?,?,1)",
    [
      "Giữ một chút đẹp đẽ, lâu hơn",
      "cach-cham-hoa-tuoi",
      "Một vài thói quen nhỏ để bó hoa luôn tươi và rạng rỡ.",
      "Một bình nước sạch là khởi đầu tốt nhất. Rửa bình thật kỹ trước khi cắm và loại bỏ những chiếc lá nằm dưới mặt nước.\n\nDùng kéo sắc cắt chéo gốc khoảng 1–2 cm. Thao tác này giúp cành hoa hút nước tốt hơn. Đừng quên thay nước mỗi ngày.\n\nHoa thích một góc mát, tránh nắng trực tiếp, luồng điều hòa và trái cây chín. Khi một bông hoa đã héo, hãy nhẹ nhàng lấy ra để những bông còn lại tiếp tục tỏa sáng.",
      "/images/vase.jpg",
    ],
  );
  await c.execute(
    "INSERT INTO posts(title,slug,excerpt,content,image,published) VALUES(?,?,?,?,?,1)",
    [
      "Tặng hoa, không cần đợi một dịp",
      "tang-hoa-khong-can-dip",
      "Có những lời thương đẹp nhất khi được nói vào một ngày bình thường.",
      "Chúng ta thường đợi đến sinh nhật, ngày kỷ niệm hoặc một dịp lớn để tặng hoa. Nhưng đôi khi, một bó hoa vào chiều thứ Ba lại khiến người nhận nhớ lâu nhất.\n\nKhông cần một bó hoa thật lớn. Hãy chọn loài hoa người ấy thích, thêm một tấm thiệp viết tay và một lời nhắn thật lòng. Đó là cách những điều giản dị trở thành kỷ niệm.",
      "/images/roses.jpg",
    ],
  );
}
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)
  throw Error("ADMIN_PASSWORD must contain at least 12 characters");
const salt = randomBytes(16).toString("hex");
const hash =
  salt + ":" + scryptSync(process.env.ADMIN_PASSWORD, salt, 64).toString("hex");
await c.execute(
  "INSERT IGNORE INTO users(name,email,password_hash,role,address) VALUES(?,?,?,'admin','')",
  ["Fleur Admin", process.env.ADMIN_EMAIL || "admin@fleur.local", hash],
);
console.log("Database ready. Admin configured from environment.");
await c.end();
