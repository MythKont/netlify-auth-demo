const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = process.env.MONGO_URI;
let client;
let clientPromise;

async function getClient() {
  if (!clientPromise) {
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    clientPromise = client.connect();
  }
  await clientPromise;
  return client;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { requester, toUsername } = JSON.parse(event.body);

    if (!requester || !toUsername) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Eksik parametre." }),
      };
    }

    if (requester === toUsername) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Kendine arkadaş isteği gönderemezsin." }),
      };
    }

    const client = await getClient();
    const users = client.db("users").collection("users");
    const friends = client.db("users").collection("friends");

    // İstenen kullanıcının var olup olmadığını kontrol et
    const toUser = await users.findOne({ username: toUsername });
    if (!toUser) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Arkadaş bulunamadı." }),
      };
    }

    // Zaten arkadaş mı veya istek gönderilmiş mi kontrolü
    const existing = await friends.findOne({
      $or: [
        { requester, to: toUsername },
        { requester: toUsername, to: requester },
      ],
    });

    if (existing) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Zaten arkadaşsınız veya istek bekliyor." }),
      };
    }

    // İstek kaydet
    await friends.insertOne({
      requester,
      to: toUsername,
      status: "pending", // pending, accepted, rejected
      createdAt: new Date(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Arkadaşlık isteği gönderildi." }),
    };
  } catch (err) {
    console.error("Friend request error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Sunucu hatası." }),
    };
  }
};
