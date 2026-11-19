export default {
  async fetch(request, env) {
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

      // 1. Handle /start command
      if (update.message.text === "/start") {
        await sendMessage(
          BOT_TOKEN,
          chatId,
          "👋 **Image Link Generator Bot Ready!**\n\nEnakku endha Photo / Image file anuppunaalum udane **Permanent Direct Image Link** generate panni tharuven! (24/7 Free)"
        );
        return new Response("OK");
      }

      // 2. Check if message has a photo or image document
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
        await sendMessage(BOT_TOKEN, chatId, "⚠️ Please oru **Photo / Image** mattum anuppunga bro!");
        return new Response("OK");
      }

      await sendMessage(BOT_TOKEN, chatId, "⏳ Generating direct image link...");

      // 3. Get file path from Telegram
      const fileInfoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
      const fileInfo = await fileInfoRes.json();

      if (!fileInfo.ok) {
        await sendMessage(BOT_TOKEN, chatId, "❌ Telegram file fetch fail aayiduchu. Thirumba try pannunga.");
        return new Response("OK");
      }

      const filePath = fileInfo.result.file_path;
      const tgFileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

      // 4. Upload to Catbox.moe for Permanent Direct Link
      const imgRes = await fetch(tgFileUrl);
      const imgBlob = await imgRes.blob();
      const ext = filePath.split(".").pop() || "jpg";

      const formData = new FormData();
      formData.append("reqtype", "fileupload");
      formData.append("fileToUpload", imgBlob, `image.${ext}`);

      const uploadRes = await fetch("https://catbox.moe/user/api.php", {
        method: "POST",
        body: formData,
      });

      const directLink = (await uploadRes.text()).trim();

      if (directLink.startsWith("https://")) {
        // 5. Send direct link to User
        await sendMessage(
          BOT_TOKEN,
          chatId,
          `✅ **Direct Image Link Ready!**\n\n🔗 **Link:**\n\`${directLink}\`\n\n📋 *(Tap link to copy)*`
        );

        // 6. Send Photo + User Info + Link to Log Channel
        if (LOG_CHANNEL) {
          const userName = user.username ? `@${user.username}` : user.first_name || "User";
          const logCaption =
            `📸 **New Image Uploaded**\n\n` +
            `👤 **User:** ${userName} (\`${user.id}\`)\n` +
            `🔗 **Link:** ${directLink}`;

          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: LOG_CHANNEL,
              photo: fileId,
              caption: logCaption,
              parse_mode: "Markdown",
            }),
          });
        }
      } else {
        await sendMessage(BOT_TOKEN, chatId, `❌ Upload failed: ${directLink}`);
      }
    } catch (err) {
      // Prevent Telegram webhook retry loops
    }

    return new Response("OK");
  },
};

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
