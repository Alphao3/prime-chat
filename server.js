const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_IN_PRODUCTION";

if (!MONGO_URI) {
  console.error("Missing MONGO_URI environment variable.");
  process.exit(1);
}

mongoose.connect(MONGO_URI).then(() => {
  console.log("MongoDB connected");
}).catch((err) => {
  console.error("MongoDB connection failed:", err.message);
  process.exit(1);
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});

messageSchema.index({ from: 1, to: 1, createdAt: 1 });

const User = mongoose.model("User", userSchema);
const Message = mongoose.model("Message", messageSchema);

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname)));

function makeToken(user) {
  return jwt.sign({ id: String(user._id), username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "يجب تسجيل الدخول" });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "جلسة الدخول انتهت" });
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!/^[\p{L}\p{N}_ .-]{3,30}$/u.test(username)) {
      return res.status(400).json({ error: "اسم المستخدم يجب أن يكون من 3 إلى 30 حرفًا." });
    }
    if (password.length < 6 || password.length > 100) {
      return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل." });
    }

    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ error: "اسم المستخدم مستخدم بالفعل." });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, passwordHash });
    const token = makeToken(user);

    res.json({
      token,
      user: { id: String(user._id), username: user.username }
    });
  } catch (e) {
    res.status(500).json({ error: "حدث خطأ في إنشاء الحساب." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    }

    user.lastSeen = new Date();
    await user.save();

    res.json({
      token: makeToken(user),
      user: { id: String(user._id), username: user.username }
    });
  } catch {
    res.status(500).json({ error: "حدث خطأ أثناء تسجيل الدخول." });
  }
});

app.get("/api/me", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("_id username");
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود." });
  res.json({ id: String(user._id), username: user.username });
});

app.get("/api/users", auth, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user.id } })
    .select("_id username lastSeen")
    .sort({ username: 1 })
    .limit(200);

  const onlineIds = new Set(
    Array.from(io.sockets.sockets.values())
      .filter(s => s.user?.id)
      .map(s => s.user.id)
  );

  res.json(users.map(u => ({
    id: String(u._id),
    username: u.username,
    online: onlineIds.has(String(u._id)),
    lastSeen: u.lastSeen
  })));
});

app.get("/api/messages/:otherId", auth, async (req, res) => {
  const me = req.user.id;
  const other = req.params.otherId;

  if (!mongoose.isValidObjectId(other)) {
    return res.status(400).json({ error: "مستخدم غير صالح." });
  }

  const messages = await Message.find({
    $or: [
      { from: me, to: other },
      { from: other, to: me }
    ]
  }).sort({ createdAt: 1 }).limit(500);

  res.json(messages.map(m => ({
    id: String(m._id),
    from: String(m.from),
    to: String(m.to),
    text: m.text,
    createdAt: m.createdAt
  })));
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("UNAUTHORIZED"));
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
});

io.on("connection", async (socket) => {
  await User.findByIdAndUpdate(socket.user.id, { lastSeen: new Date() });

  socket.join(`user:${socket.user.id}`);

  io.emit("presence", {
    userId: socket.user.id,
    online: true
  });

  socket.on("typing", ({ to }) => {
    if (mongoose.isValidObjectId(to)) {
      io.to(`user:${to}`).emit("typing", {
        from: socket.user.id,
        username: socket.user.username
      });
    }
  });

  socket.on("stopTyping", ({ to }) => {
    if (mongoose.isValidObjectId(to)) {
      io.to(`user:${to}`).emit("stopTyping", {
        from: socket.user.id
      });
    }
  });

  socket.on("privateMessage", async ({ to, text }) => {
    try {
      if (!mongoose.isValidObjectId(to)) return;
      text = String(text || "").trim().slice(0, 2000);
      if (!text) return;

      const recipient = await User.findById(to).select("_id username");
      if (!recipient) return;

      const msg = await Message.create({
        from: socket.user.id,
        to,
        text
      });

      const payload = {
        id: String(msg._id),
        from: String(msg.from),
        to: String(msg.to),
        text: msg.text,
        createdAt: msg.createdAt
      };

      io.to(`user:${socket.user.id}`).emit("privateMessage", payload);
      io.to(`user:${to}`).emit("privateMessage", payload);
    } catch (e) {
      socket.emit("chatError", "تعذر إرسال الرسالة.");
    }
  });

  socket.on("disconnect", async () => {
    const stillOnline = Array.from(io.sockets.sockets.values())
      .some(s => s.user?.id === socket.user.id);

    if (!stillOnline) {
      await User.findByIdAndUpdate(socket.user.id, { lastSeen: new Date() });
      io.emit("presence", {
        userId: socket.user.id,
        online: false,
        lastSeen: new Date()
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Prime Chat running on port ${PORT}`);
});
