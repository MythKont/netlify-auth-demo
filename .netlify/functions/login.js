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

  const { identifier, password } = JSON.parse(event.body);

  if (!identifier || !password) {
    return { statusCode: 400, body: "Lütfen tüm alanları doldurunuz." };
  }

  try {
    const client = await getClient();
    const users = client.db("users").collection("users");

    const user = await users.findOne({
      $or: [{ email: identifier }, { username: identifier }],
      password,
    });

    if (!user) {
      return { statusCode: 401, body: "Geçersiz kullanıcı adı veya şifre." };
    }

    return { statusCode: 200, body: "Giriş başarılı." };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Sunucu hatası." };
  }
};
