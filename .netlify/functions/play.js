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

exports.handler = async (event) => {
  try {
    const client = await getClient();
    const db = client.db("users");
    const users = db.collection("users");
    const rooms = db.collection("rooms");

    if (event.httpMethod === "GET") {
      const { type, username } = event.queryStringParameters;

      if (type === "balance") {
        const user = await users.findOne({ username });
        return {
          statusCode: 200,
          body: JSON.stringify({ balance: user?.balance ?? 0 }),
        };
      }

      if (type === "listRooms") {
        const openRooms = await rooms.find({ player2: null }).toArray();
        return {
          statusCode: 200,
          body: JSON.stringify(
            openRooms.map((room) => ({
              _id: room._id,
              player1: room.player1,
              bet: room.bet,
              choice1: room.choice1,
            }))
          ),
        };
      }
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);
      const { type, username, choice, roomId, bet, pick } = body;

      if (type === "join") {
        // Join existing room by id
        if (!roomId) {
          return { statusCode: 400, body: "Oda ID belirtilmeli." };
        }

        const room = await rooms.findOne({ _id: new ObjectId(roomId) });

        if (!room) {
          return { statusCode: 404, body: "Böyle bir oda bulunmamakta." };
        }

        if (room.player2) {
          return { statusCode: 400, body: "Oda dolu." };
        }

        // Katılan oyuncunun bakiyesi yeterli mi?
        const player2 = await users.findOne({ username });
        if (!player2 || player2.balance < room.bet) {
          return {
            statusCode: 400,
            body: "Yeterli bakiye yok.",
          };
        }

        // Katılan oyuncu balance azaltma (rezervasyon)
        await users.updateOne({ username }, { $inc: { balance: -room.bet } });

        // Güncelle odadaki player2
        await rooms.updateOne(
          { _id: room._id },
          {
            $set: { player2: username, choice2: null, status: "waiting" },
          }
        );

        // Oda sahibinin bakiyesi azaltıldı mı? Evet, oda açarken azalacak.

        return {
          statusCode: 200,
          body: JSON.stringify({ status: "ready", roomId: room._id.toString() }),
        };
      }

      if (type === "create") {
        // Oda açma: bahis miktarı ve seçim (yazı/tura) zorunlu
        if (!bet || !pick) {
          return { statusCode: 400, body: "Bahis ve seçim gerekli." };
        }

        const player = await users.findOne({ username });
        if (!player || player.balance < bet) {
          return { statusCode: 400, body: "Yeterli bakiye yok." };
        }

        // Kullanıcının varsa eski odasını sil
        await rooms.deleteMany({ player1: username });

        // Bakiye rezervasyonu (bahis tutarı)
        await users.updateOne({ username }, { $inc: { balance: -bet } });

        // Oda oluştur
        const insertResult = await rooms.insertOne({
          player1: username,
          player2: null,
          choice1: pick,
          choice2: null,
          bet,
          status: "waiting",
          createdAt: new Date(),
        });

        return {
          statusCode: 200,
          body: JSON.stringify({ status: "waiting", roomId: insertResult.insertedId.toString() }),
        };
      }

      if (type === "leave") {
        // Odayı bul
        const room = await rooms.findOne({
          $or: [{ player1: username }, { player2: username }],
        });

        if (room) {
          // Odayı sil
          await rooms.deleteOne({ _id: room._id });

          // Bakiye iadesi (oda sahibi ve varsa katılan)
          await users.updateOne({ username: room.player1 }, { $inc: { balance: room.bet } });
          if (room.player2) {
            await users.updateOne({ username: room.player2 }, { $inc: { balance: room.bet } });
          }
        }

        return {
          statusCode: 200,
          body: JSON.stringify({ message: "Oda kapatıldı." }),
        };
      }

      if (type === "choice") {
        // Oyun seçim yapma

        if (!roomId || !choice) {
          return { statusCode: 400, body: "Oda ID ve seçim gerekli." };
        }

        const room = await rooms.findOne({ _id: new ObjectId(roomId) });
        if (!room) {
          return { statusCode: 404, body: "Böyle bir oda bulunmamakta." };
        }

        if (room.player1 !== username && room.player2 !== username) {
          return { statusCode: 403, body: "Bu odada değilsiniz." };
        }

        const field = room.player1 === username ? "choice1" : "choice2";
        await rooms.updateOne({ _id: room._id }, { $set: { [field]: choice } });

        const updatedRoom = await rooms.findOne({ _id: room._id });

        if (updatedRoom.choice1 && updatedRoom.choice2) {
          // 10 saniye bekleme (bu backend'de değil frontend'de olacak)

          // Sonuç belirle (yazı/tura random)
          const coin = Math.random() < 0.5 ? "yazı" : "tura";

          let winner = null;
          if (updatedRoom.choice1 === coin && updatedRoom.choice2 !== coin) winner = updatedRoom.player1;
          else if (updatedRoom.choice2 === coin && updatedRoom.choice1 !== coin) winner = updatedRoom.player2;

          if (winner) {
            await users.updateOne({ username: winner }, { $inc: { balance: updatedRoom.bet * 2 } });
          } else {
            // Beraberlik ise her iki oyuncuya bahis iadesi
            await users.updateOne({ username: updatedRoom.player1 }, { $inc: { balance: updatedRoom.bet } });
            await users.updateOne({ username: updatedRoom.player2 }, { $inc: { balance: updatedRoom.bet } });
          }

          // Odayı sil
          await rooms.deleteOne({ _id: room._id });

          return {
            statusCode: 200,
            body: JSON.stringify({
              message: `Yazı Tura: ${coin} – ${winner ? `${winner} kazandı!` : "Beraberlik!"}`,
              player1: updatedRoom.player1,
              player2: updatedRoom.player2,
              result: coin,
              winner,
            }),
          };
        } else {
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: "Rakip seçimi bekleniyor...",
              player1: updatedRoom.player1,
              player2: updatedRoom.player2,
            }),
          };
        }
      }
    }

    return { statusCode: 400, body: "Geçersiz istek" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Sunucu hatası" };
  }
};
