const { MongoClient, ServerApiVersion } = require("mongodb");

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
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);
      const { type, username, choice } = body;

      if (type === "join") {
        let room = await rooms.findOne({ player2: null });

        if (room && room.player1 !== username) {
          await rooms.updateOne(
            { _id: room._id },
            { $set: { player2: username, status: "ready" } }
          );
          return { statusCode: 200, body: JSON.stringify({ status: "ready" }) };
        } else {
          await rooms.insertOne({ player1: username, player2: null, status: "waiting" });
          return { statusCode: 200, body: JSON.stringify({ status: "waiting" }) };
        }
      }

      if (type === "choice") {
        let room = await rooms.findOne({
          $or: [{ player1: username }, { player2: username }],
        });

        if (!room) return { statusCode: 400, body: "Oda bulunamadı" };

        const field = room.player1 === username ? "choice1" : "choice2";
        await rooms.updateOne({ _id: room._id }, { $set: { [field]: choice } });

        room = await rooms.findOne({ _id: room._id });
        if (room.choice1 && room.choice2) {
          const coin = Math.random() < 0.5 ? "yazı" : "tura";

          let winner = null;
          if (room.choice1 === coin && room.choice2 !== coin) winner = room.player1;
          else if (room.choice2 === coin && room.choice1 !== coin) winner = room.player2;

          if (winner) {
            await users.updateOne({ username: winner }, { $inc: { balance: 100 } });
            const loser = winner === room.player1 ? room.player2 : room.player1;
            await users.updateOne({ username: loser }, { $inc: { balance: -100 } });
          }

          await rooms.deleteOne({ _id: room._id });

          return {
            statusCode: 200,
            body: JSON.stringify({
              message: `Yazı Tura: ${coin} – ${
                winner ? `${winner} kazandı!` : "Beraberlik!"
              }`,
            }),
          };
        } else {
          return {
            statusCode: 200,
            body: JSON.stringify({ message: "Rakip seçimi bekleniyor..." }),
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
