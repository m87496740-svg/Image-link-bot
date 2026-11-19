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
      const text = update.message.text || "";
      const BOT_TOKEN = env.BOT_TOKEN;
      const LOG_CHANNEL = env.LOG_CHANNEL;
      const GITHUB_TOKEN = env.GITHUB_TOKEN;

      // 1. Commands (/start, /help, /ping)
      if (text === "/start" || text === "/help") {
        await sendMessage(
          BOT_TOKEN,
          chatId,
          "👋 <b>Welcome to Image Direct Link Bot!</b>\n\n" +
            "Send me any <b>Photo</b> or <b>Image File</b> (JPG, PNG, WEBP), and I will generate a <b>Permanent Direct Link</b>.\n\n" +
            "⚡ <b>Speed:</b> Ultra-Fast Edge\n" +
            "🔒 <b>Storage:</b> Permanent Cloud\n" +
            "🌐 <b>Uptime:</b> 24/7 Online\n\n" +
            "📌 <i>Commands: /start • /ping</i>"
        );
        return new Response("OK");
      }

      if (text === "/ping") {
        const start = Date.now();
        await sendMessage(BOT_TOKEN, chatId, `🏓 <b>Pong!</b> Bot is active 24/7 (${Date.now() - start}ms)`);
        return new Response("OK");
      }

      // 2. Get highest-res photo or image document
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
        await sendMessage(BOT_TOKEN, chatId, "⚠️ Please send a valid <b>Photo</b> or <b>Image file</b>.");
        return new Response("OK");
      }

      // Non-blocking typing/upload indicator
      ctx.waitUntil(
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, action: "upload_photo" }),
        })
      );

      // 3. Fetch Telegram file path & download binary in parallel-ready flow
      const fileInfoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
      const fileInfo = await fileInfoRes.json();

      if (!fileInfo.ok) {
        await sendMessage(BOT_TOKEN, chatId, "❌ Could not fetch image from Telegram. Try again.");
        return new Response("OK");
      }

      const filePath = fileInfo.result.file_path;
      const imgRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
      const arrayBuffer = await imgRes.arrayBuffer();
      const base64Content = arrayBufferToBase64(arrayBuffer);

      // 4. Upload to GitHub repository
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

        // 5. Instant Reply with Open Image Button & Tap-to-Copy URL
        await sendMessage(
          BOT_TOKEN,
          chatId,
          `✅ <b>Direct Image Link Ready!</b>\n\n` +
            `🔗 <b>Direct URL:</b>\n<code>${directLink}</code>\n\n` +
            `📋 <i>Tap the link above to copy</i>`,
          {
            inline_keyboard: [[{ text: "🌐 Open Image", url: directLink }]],
          }
        );

        // 6. Background Log Channel task (Zero speed delay to user!)
        if (LOG_CHANNEL) {
          ctx.waitUntil(
            (async () => {
              const safeName = escapeHtml(user.first_name || "User");
              const userTag = user.username ? `@${escapeHtml(user.username)}` : safeName;
              const logCaption =
                `📸 <b>New Image Uploaded</b>\n\n` +
                `👤 <b>User:</b> ${userTag} (<code>${user.id}</code>)\n` +
                `🔗 <b>Link:</b> ${directLink}`;

              const logRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: String(LOG_CHANNEL).trim(),
                  photo: fileId,
                  caption: logCaption,
                  parse_mode: "HTML",
                }),
              });

              const logData = await logRes.json();
              if (!logData.ok) {
                await sendMessage(
                  BOT_TOKEN,
                  chatId,
                  `⚠️ <b>Log Channel Failed:</b> <code>${escapeHtml(logData.description)}</code>`
                );
              }
            })()
          );
        }
      } else {
        await sendMessage(BOT_TOKEN, chatId, `❌ Upload failed: ${escapeHtml(ghData.message || "Unknown error")}`);
      }
    } catch (err) {
      // Prevent Telegram webhook retries
    }

    return new Response("OK");
  },
};

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendMessage(token, chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
