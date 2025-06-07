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
    const { query } = JSON.parse(event.body);

    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Arama sorgusu boş olamaz." }),
      };
    }

    const client = await getClient();
    const users = client.db("users").collection("users");

    // query, kullanıcı adı veya email olabilir (case insensitive)
    const regex = new RegExp(query, "i");

    const results = await users
      .find({
        $or: [{ username: regex }, { email: regex }],
      })
      .project({ username: 1, email: 1, _id: 0 })
      .limit(10)
      .toArray();

    return {
      statusCode: 200,
      body: JSON.stringify(results),
    };
  } catch (err) {
    console.error("Friend search error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Sunucu hatası." }),
    };
  }
};
