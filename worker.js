export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Image Link Generator Bot is Live 24/7!", { status: 200 });
    }

    try {
      const update = await request.json();
      if (!update.message) return new Response("OK");

      const chatId = update.message.chat.id;
      const user = update.message.from;
      const BOT_TOKEN = env.BOT_TOKEN;
      const LOG_CHANNEL = env.LOG_CHANNEL;
      const GITHUB_TOKEN = env.GITHUB_TOKEN;

      // 1. Handle /start command (English)
      if (update.message.text === "/start") {
        await sendMessage(
          BOT_TOKEN,
          chatId,
          "👋 **Welcome to Image Direct Link Bot!**\n\nSend me any **Photo** or **Image file**, and I will instantly generate a **Permanent Direct Image Link** for you.\n\n⚡ Fast • 🔒 Permanent • 🌐 24/7 Online"
        );
        return new Response("OK");
      }

      // 2. Extract highest-resolution photo or image document
      let fileId = null;
      if (update.message.photo) {
        fileId = update.message.photo[update.message.photo.length - 1].file_id;
      } else if (
        update.message.document &&
        update.message.document.mime_type &&
        update.message.document.mime_type.startsWith("image/")
      ) {
        fileId = update.message.document.file_id;
      }

      if (!fileId) {
        await sendMessage(BOT_TOKEN, chatId, "⚠️ Please send a valid **Photo** or **Image file**.");
        return new Response("OK");
      }

      // Show "uploading photo..." status instead of sending a slow extra text message
      ctx.waitUntil(
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, action: "upload_photo" }),
        })
      );

      // 3. Fetch file path from Telegram
      const fileInfoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
      const fileInfo = await fileInfoRes.json();

      if (!fileInfo.ok) {
        await sendMessage(BOT_TOKEN, chatId, "❌ Failed to fetch image from Telegram. Please try again.");
        return new Response("OK");
      }

      const filePath = fileInfo.result.file_path;
      const tgFileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
      const imgRes = await fetch(tgFileUrl);
      const arrayBuffer = await imgRes.arrayBuffer();

      // 4. Fast chunked Base64 encoding
      const base64Content = arrayBufferToBase64(arrayBuffer);

      // 5. Upload directly to GitHub repository
      const ext = filePath.split(".").pop() || "jpg";
      const fileName = `img_${Date.now()}.${ext}`;
      const repoOwner = "m87496740-svg";
      const repoName = "Image-link-bot";
      const uploadPath = `uploads/${fileName}`;

      const ghRes = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${uploadPath}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            "User-Agent": "Cloudflare-Worker-Bot",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `Upload ${fileName}`,
            content: base64Content,
          }),
        }
      );

      const ghData = await ghRes.json();

      if (ghRes.ok && ghData.content) {
        const directLink = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/${uploadPath}`;

        // 6. Send direct link immediately to user
        await sendMessage(
          BOT_TOKEN,
          chatId,
          `✅ **Direct Image Link Generated!**\n\n🔗 **URL:**\n\`${directLink}\`\n\n📋 *(Tap the link to copy)*`
        );

        // 7. Log photo & user details in background (zero delay for user)
        if (LOG_CHANNEL) {
          const userName = user.username ? `@${user.username}` : user.first_name || "User";
          const logCaption =
            `📸 **New Image Uploaded**\n\n` +
            `👤 **User:** ${userName} (\`${user.id}\`)\n` +
            `🔗 **Direct Link:** ${directLink}`;

          ctx.waitUntil(
            fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: LOG_CHANNEL,
                photo: fileId,
                caption: logCaption,
                parse_mode: "Markdown",
              }),
            })
          );
        }
      } else {
        await sendMessage(BOT_TOKEN, chatId, `❌ Upload failed: ${ghData.message || "Unknown error"}`);
      }
    } catch (err) {
      // Prevent Telegram retry loops
    }

    return new Response("OK");
  },
};

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks for high speed
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sendMessage(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown",
    }),
  });
}
