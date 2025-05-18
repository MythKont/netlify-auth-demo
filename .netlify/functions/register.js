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
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { email, username, password } = JSON.parse(event.body);

  if (!email || !username || !password) {
    return { statusCode: 400, body: "Lütfen tüm alanları doldurunuz." };
  }

  try {
    const client = await getClient();
    const users = client.db("users").collection("users");

    const existingUser = await users.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      return { statusCode: 400, body: "Bu kullanıcı zaten kayıtlı." };
    }

    // Başlangıç bakiyesi: 1000
    await users.insertOne({
      email,
      username,
      password,
      balance: 1000,
    });

    return { statusCode: 200, body: "Kayıt başarılı." };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Sunucu hatası." };
  }
};
