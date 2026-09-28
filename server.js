const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();

const server = http.createServer(app);

const io = new Server(server);

const PORT =
  process.env.PORT || 3000;


/* عرض الموقع */

app.use(
  express.static(__dirname)
);


app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );

});


/* المستخدمون المتصلون */

const users = new Map();


/* Socket.IO */

io.on(
  "connection",
  (socket) => {

    console.log(
      "User connected:",
      socket.id
    );


    /* دخول المستخدم */

    socket.on(
      "join",
      (name) => {

        name =
          String(name || "مستخدم")
            .trim()
            .slice(0,30);


        users.set(
          socket.id,
          {
            id: socket.id,
            name: name
          }
        );


        io.emit(
          "users",
          Array.from(
            users.values()
          )
        );


        socket.broadcast.emit(
          "system",
          {
            text:
              name +
              " دخل الشات 👋"
          }
        );

      }
    );


    /* إرسال رسالة */

    socket.on(
      "sendMessage",
      (data) => {

        const user =
          users.get(socket.id);


        if(!user) return;


        const text =
          String(
            data?.text || ""
          )
          .trim()
          .slice(0,2000);


        if(!text) return;


        const message = {

          senderId:
            socket.id,

          senderName:
            user.name,

          text:
            text,

          time:
            new Date()
              .toISOString()

        };


        io.emit(
          "message",
          message
        );

      }
    );


    /* يكتب الآن */

    socket.on(
      "typing",
      () => {

        const user =
          users.get(socket.id);


        if(!user) return;


        socket.broadcast.emit(
          "typing",
          {
            name: user.name
          }
        );

      }
    );


    /* توقف عن الكتابة */

    socket.on(
      "stopTyping",
      () => {

        socket.broadcast.emit(
          "stopTyping"
        );

      }
    );


    /* خروج المستخدم */

    socket.on(
      "disconnect",
      () => {

        const user =
          users.get(socket.id);


        if(user){

          users.delete(
            socket.id
          );


          io.emit(
            "users",
            Array.from(
              users.values()
            )
          );


          socket.broadcast.emit(
            "system",
            {
              text:
                user.name +
                " خرج من الشات"
            }
          );

        }


        console.log(
          "User disconnected:",
          socket.id
        );

      }
    );

  }
);


/* تشغيل السيرفر */

server.listen(
  PORT,
  () => {

    console.log(
      `Prime Chat يعمل على http://localhost:${PORT}`
    );

  }
);
