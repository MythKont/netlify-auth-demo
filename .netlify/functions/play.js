// netlify/functions/play.js
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = process.env.MONGO_URI;
let client;

async function getClient() {
  if (!client) {
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await client.connect();
  }
  return client;
}

function getCurrentTimestamp() {
  return Date.now();
}

exports.handler = async (event) => {
  try {
    const client = await getClient();
    const db = client.db("users");
    const users = db.collection("users");
    const rooms = db.collection("rooms");

    if (event.httpMethod === "GET") {
      const { type, username } = event.queryStringParameters || {};

      if (type === "balance") {
        const user = await users.findOne({ username });
        return {
          statusCode: 200,
          body: JSON.stringify({ balance: user?.balance ?? 0 }),
        };
      }

      if (type === "rooms") {
        // Açık olan odaları listele (status waiting ya da ready)
        const openRooms = await rooms
          .find({ status: { $in: ["waiting", "ready"] } })
          .project({ player1: 1, bet: 1, choice: 1, status: 1 })
          .toArray();

        return {
          statusCode: 200,
          body: JSON.stringify(openRooms),
        };
      }
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);
      const { type, username, bet, choice, roomId } = body;

      if (type === "createRoom") {
        if (!bet || !choice || !username) {
          return { statusCode: 400, body: "Eksik parametre." };
        }

        // Kullanıcının yeterli bakiyesi var mı?
        const user = await users.findOne({ username });
        if (!user || user.balance < bet) {
          return { statusCode: 400, body: "Yetersiz bakiye." };
        }

        // Bahis miktarı kullanıcıdan alınır, oda yazı/tura seçimi de kullanıcı tarafından belirlenir
        const roomDoc = {
          player1: username,
          player2: null,
          bet,
          choice, // 'yazı' veya 'tura'
          status: "waiting", // oyuncu bekleniyor
          createdAt: getCurrentTimestamp(),
        };

        const res = await rooms.insertOne(roomDoc);

        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Oda oluşturuldu.", roomId: res.insertedId }),
        };
      }

      if (type === "joinRoom") {
        if (!roomId || !username) {
          return { statusCode: 400, body: "Eksik parametre." };
        }

        const room = await rooms.findOne({ _id: new ObjectId(roomId) });

        if (!room) {
          return { statusCode: 404, body: "Oda bulunamadı." };
        }

        if (room.status !== "waiting") {
          return { statusCode: 400, body: "Oda zaten dolu veya oyun başladı." };
        }

        if (room.player1 === username) {
          return { statusCode: 400, body: "Kendi odana katılamazsın." };
        }

        const user = await users.findOne({ username });
        if (!user || user.balance < room.bet) {
          return { statusCode: 400, body: "Yetersiz bakiye." };
        }

        // Odaya katılan oyuncunun bakiyesi tamam, odada player2 olarak ekle
        await rooms.updateOne(
          { _id: room._id },
          {
            $set: { player2: username, status: "ready", startTime: getCurrentTimestamp() },
          }
        );

        return { statusCode: 200, body: JSON.stringify({ message: "Odaya katıldınız." }) };
      }

      if (type === "getRoom") {
        if (!roomId) {
          return { statusCode: 400, body: "Eksik parametre." };
        }

        const room = await rooms.findOne({ _id: new ObjectId(roomId) });

        if (!room) {
          return { statusCode: 404, body: "Oda bulunamadı." };
        }

        return {
          statusCode: 200,
          body: JSON.stringify(room),
        };
      }

      if (type === "getResult") {
        // Bu endpoint, frontend'in 10 saniyelik sayaç bittikten sonra sonucu çekmesi için
        if (!roomId) {
          return { statusCode: 400, body: "Eksik parametre." };
        }

        const room = await rooms.findOne({ _id: new ObjectId(roomId) });

        if (!room) {
          return { statusCode: 404, body: "Oda bulunamadı." };
        }

        if (room.status !== "ready" && room.status !== "finished") {
          return { statusCode: 400, body: "Oyun başlamadı." };
        }

        // Rastgele yazı ya da tura seç (tek seferlik, sonuç yoksa belirle)
        if (!room.result) {
          const coin = Math.random() < 0.5 ? "yazı" : "tura";

          let winner = null;
          if (coin === room.choice) winner = room.player1;
          else winner = room.player2;

          // Bakiyeleri güncelle
          await users.updateOne({ username: winner }, { $inc: { balance: room.bet * 2 } });
          const loser = winner === room.player1 ? room.player2 : room.player1;
          await users.updateOne({ username: loser }, { $inc: { balance: -room.bet } });

          // Sonucu ve durumu güncelle
          await rooms.updateOne(
            { _id: room._id },
            { $set: { status: "finished", result: coin, winner } }
          );

          return {
            statusCode: 200,
            body: JSON.stringify({ result: coin, winner }),
          };
        } else {
          // Sonuç zaten varsa onu döndür
          return {
            statusCode: 200,
            body: JSON.stringify({ result: room.result, winner: room.winner }),
          };
        }
      }
    }

    return { statusCode: 400, body: "Geçersiz istek." };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Sunucu hatası." };
  }
};
