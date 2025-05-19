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
    const { identifier, password } = JSON.parse(event.body);

    if (!identifier || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Lütfen tüm alanları doldurunuz." }),
      };
    }

    const client = await getClient();
    const users = client.db("users").collection("users");

    const user = await users.findOne({
      $or: [{ email: identifier }, { username: identifier }],
      password,
    });

    if (!user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Geçersiz kullanıcı adı veya şifre." }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Giriş başarılı.",
        username: user.username,
      }),
    };
  } catch (err) {
    console.error("Login error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Sunucu hatası", error: err.message }),
    };
  }
};
