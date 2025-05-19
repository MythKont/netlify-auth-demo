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

function now() {
  return Date.now();
}

exports.handler = async (event) => {
  try {
    const client = await getClient();
    const db = client.db("users");
    const users = db.collection("users");
    const rooms = db.collection("rooms");

    // GET işlemleri
    if (event.httpMethod === "GET") {
      const { type, username } = event.queryStringParameters || {};

      if (type === "balance") {
        const u = await users.findOne({ username });
        return { statusCode: 200, body: JSON.stringify({ balance: u?.balance || 0 }) };
      }

      if (type === "rooms") {
        const open = await rooms
          .find({ status: { $in: ["waiting"] } })
          .project({ player1: 1, bet: 1, choice: 1 })
          .toArray();
        return { statusCode: 200, body: JSON.stringify(open) };
      }
    }

    // POST işlemleri
    if (event.httpMethod === "POST") {
      const b = JSON.parse(event.body);
      const { type, username, bet, choice, roomId } = b;

      // Oda oluştur
      if (type === "createRoom") {
        if (!username || !bet || !choice) return { statusCode: 400, body: "Eksik parametre." };
        const u = await users.findOne({ username });
        if (!u || u.balance < bet) return { statusCode: 400, body: "Yetersiz bakiye." };

        const r = {
          player1: username,
          player2: null,
          bet,
          choice,
          status: "waiting",
          createdAt: now(),
        };
        const res = await rooms.insertOne(r);
        return { statusCode: 200, body: JSON.stringify({ message: "Oda oluşturuldu.", roomId: res.insertedId }) };
      }

      // Odaya katıl
      if (type === "joinRoom") {
        if (!username || !roomId) return { statusCode: 400, body: "Eksik parametre." };
        const room = await rooms.findOne({ _id: new ObjectId(roomId) });
        if (!room) return { statusCode: 404, body: "Oda bulunamadı." };
        if (room.status !== "waiting") return { statusCode: 400, body: "Oda dolu veya başladı." };
        if (room.player1 === username) return { statusCode: 400, body: "Kendi odana katılamazsın." };
        const u = await users.findOne({ username });
        if (!u || u.balance < room.bet) return { statusCode: 400, body: "Yetersiz bakiye." };

        await rooms.updateOne(
          { _id: room._id },
          { $set: { player2: username, status: "ready", startTime: now() } }
        );
        return { statusCode: 200, body: JSON.stringify({ message: "Odaya katıldınız." }) };
      }

      // Odayı çek
      if (type === "getRoom") {
        if (!roomId) return { statusCode: 400, body: "Eksik parametre." };
        const room = await rooms.findOne({ _id: new ObjectId(roomId) });
        if (!room) return { statusCode: 404, body: "Oda bulunamadı." };
        return { statusCode: 200, body: JSON.stringify(room) };
      }

      // Sonucu al
      if (type === "getResult") {
        if (!roomId) return { statusCode: 400, body: "Eksik parametre." };
        const room = await rooms.findOne({ _id: new ObjectId(roomId) });
        if (!room) return { statusCode: 404, body: "Oda bulunamadı." };

        // Sonuç daha belirlenmediyse hesapla
        if (!room.result) {
          const coin = Math.random() < 0.5 ? "yazı" : "tura";
          const winner = coin === room.choice ? room.player1 : room.player2;
          const loser = winner === room.player1 ? room.player2 : room.player1;

          // Bahis dağılımı: kazanan +bahis, kaybeden -bahis
          await users.updateOne({ username: winner }, { $inc: { balance: room.bet } });
          await users.updateOne({ username: loser }, { $inc: { balance: -room.bet } });

          await rooms.updateOne(
            { _id: room._id },
            { $set: { status: "finished", result: coin, winner } }
          );
          return { statusCode: 200, body: JSON.stringify({ result: coin, winner, player1: room.player1, player2: room.player2 }) };
        } else {
          return { statusCode: 200, body: JSON.stringify({ result: room.result, winner: room.winner, player1: room.player1, player2: room.player2 }) };
        }
      }

      // Odayı terk et / sil
      if (type === "leave") {
        if (!username) return { statusCode: 400, body: "Eksik parametre." };
        const room = await rooms.findOne({
          $or: [{ player1: username }, { player2: username }],
        });
        if (room) await rooms.deleteOne({ _id: room._id });
        return { statusCode: 200, body: JSON.stringify({ message: "Oda kapatıldı." }) };
      }
    }

    return { statusCode: 400, body: "Geçersiz istek." };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: "Sunucu hatası." };
  }
};
