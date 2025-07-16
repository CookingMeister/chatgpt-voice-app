const OPENAI_API_KEY = "YOUR_API_KEY_HERE";

class ChatGPTClient {
  constructor() {
    this.isTextToSpeechSupported = false;
    this.isSpeechInProgress = false;
    this.isListening = false;
    this.speechRecognizer = null;
    this.speechSynthesisUtterance = null;
    this.voices = null;
    this.conversationHistory = []; // Store conversation history
    this.speechTimeout = null;

    this.initializeSpeechFeatures();
    this.updateStatus("Ready");

    // Focus on input when page loads
    setTimeout(() => {
      this.setInitialChatState();
      this.focusOnInput();
    }, 100);
  }

  showChatOutput() {
    const chatOutput = document.getElementById("chatOutput");
    const chatContainer = document.querySelector(".chat-workspace");

    if (chatOutput) {
      chatOutput.classList.remove("hidden");
      chatOutput.classList.add("show");
    }

    if (chatContainer) {
      chatContainer.classList.remove("compact");
      chatContainer.classList.add("expanded");
    }
  }

  hideChatOutput() {
    const chatOutput = document.getElementById("chatOutput");
    const chatContainer = document.querySelector(".chat-workspace");

    if (chatOutput) {
      chatOutput.classList.add("hidden");
      chatOutput.classList.remove("show");
    }

    if (chatContainer) {
      chatContainer.classList.add("compact");
      chatContainer.classList.remove("expanded");
    }
  }

  // set initial state
  setInitialChatState() {
    const chatContainer = document.querySelector(".chat-workspace");
    if (chatContainer) {
      chatContainer.classList.add("compact");
    }
  }

  focusOnInput() {
    const txtMsg = document.getElementById("txtMsg");
    if (txtMsg) {
      txtMsg.focus();
    }
  }

  initializeMarkdown() {
    // Configure marked.js if available
    if (typeof marked !== "undefined") {
      marked.setOptions({
        breaks: true,
        gfm: true,
        highlight: function (code, lang) {
          // Use Prism.js for syntax highlighting if available
          if (typeof Prism !== "undefined" && lang && Prism.languages[lang]) {
            return Prism.highlight(code, Prism.languages[lang], lang);
          }
          return code;
        },
      });
    }
  }

  // Function to render markdown text to HTML
  renderMarkdown(text) {
    if (typeof marked !== "undefined") {
      try {
        return marked.parse(text);
      } catch (error) {
        console.warn("Markdown parsing error:", error);
        return this.basicMarkdownFallback(text);
      }
    } else {
      // Fallback: basic markdown-like formatting
      return this.basicMarkdownFallback(text);
    }
  }

  // Basic markdown fallback for improved stability
  basicMarkdownFallback(text) {
    // Escape HTML to prevent XSS, but keep track of code blocks to avoid double-escaping.
    const escapeHtml = (str) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    // 1. Process and protect code blocks
    text = text.replace(/```([\s\S]*?)```/g, (match, code) => {
      const escapedCode = escapeHtml(code);
      return `<pre><code>${escapedCode}</code></pre>`;
    });
    text = text.replace(
      /`([^`]+)`/g,
      (match, code) => `<code>${escapeHtml(code)}</code>`
    );

    // 2. Process block-level elements (headers, lists)
    let html = text
      .replace(/^# (.*$)/gm, "<h1>$1</h1>")
      .replace(/^## (.*$)/gm, "<h2>$1</h2>")
      .replace(/^### (.*$)/gm, "<h3>$1</h3>")
      .replace(/^[\*\-\+] (.+)/gm, "<li>$1</li>")
      .replace(/<\/li>\n<li>/g, "</li><li>") // Join consecutive list items
      .replace(/((<li>.*<\/li>)+)/g, "<ul>$1</ul>"); // Wrap list items in <ul>

    // 3. Process remaining text into paragraphs and apply inline formatting
    const blocks = html.split(/\n\n+/);
    return blocks
      .map((block) => {
        if (block.startsWith("<") && block.endsWith(">")) {
          // Assume it's already a HTML block (like <ul> or <h1>)
          return block;
        }

        // Apply inline formatting and wrap in a paragraph
        let inlineHtml = block
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/__(.*?)__/g, "<strong>$1</strong>")
          .replace(/\*([^\s*](?:.*?[^\s*])?)\*/g, "<em>$1</em>") // More robust italics
          .replace(/_([^\s_](?:.*?[^\s_])?)_/g, "<em>$1</em>") // More robust italics
          .replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank">$1</a>'
          )
          .replace(/\n/g, "<br>"); // Convert single newlines to <br>

        return `<p>${inlineHtml}</p>`;
      })
      .join("")
      .replace(/<p><(h[1-3]|ul|pre)>/g, "<$1>") // Cleanup paragraphs wrongly wrapping blocks
      .replace(/<\/(h[1-3]|ul|pre)><\/p>/g, "</$1>");
  }

  // Escape HTML to prevent XSS
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Extract plain text from markdown for speech synthesis
  extractPlainText(markdownText) {
    // Remove markdown syntax for speech
    return markdownText
      .replace(/#{1,6}\s+/g, "") // Remove headers
      .replace(/\*\*([^*]+)\*\*/g, "$1") // Non-greedy bold
      .replace(/__([^_]+)__/g, "$1") // Non-greedy bold
      .replace(/\*([^*]+)\*/g, "$1") // Non-greedy italic
      .replace(/_([^_]+)_/g, "$1") // Non-greedy italic
      .replace(/```[\s\S]*?```/g, "[code block]") // Replace code blocks
      .replace(/`([^`]+)`/g, "$1") // Remove inline code backticks
      .replace(/^[\*\-\+]\s+/gm, "") // Remove list bullets
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Remove links, keep text
      .replace(/\n+/g, " ") // Replace newlines with spaces
      .trim();
  }

  initializeSpeechFeatures() {
    // Check for speech recognition support
    if (!("webkitSpeechRecognition" in window)) {
      const lblSpeak = document.getElementById("lblSpeak");
      if (lblSpeak) lblSpeak.style.display = "none";
    }

    // Check for text-to-speech support
    if ("speechSynthesis" in window) {
      this.isTextToSpeechSupported = true;
      speechSynthesis.onvoiceschanged = () => {
        this.voices = window.speechSynthesis.getVoices();
        const selVoices = document.getElementById("selVoices");
        if (selVoices) {
          // Clear existing options
          selVoices.innerHTML = '<option value="">Default Voice</option>';
          this.voices.forEach((voice, index) => {
            const option = new Option(voice.name, index);
            selVoices.appendChild(option);
          });
        }
      };
    }
  }

  changeLang(languageCode) {
    if (this.speechRecognizer) {
      this.speechRecognizer.lang = languageCode;
    }
    this.updateStatus(`Language changed to ${languageCode}`);
  }

  async sendMessage() {
    const txtMsg = document.getElementById("txtMsg");
    if (!txtMsg) {
      console.error("Required DOM elements not found");
      return;
    }

    const question = txtMsg.value.trim();
    if (!question) {
      alert("Type in your question!");
      txtMsg.focus();
      return;
    }

    if (!OPENAI_API_KEY || OPENAI_API_KEY === "YOUR_API_KEY_HERE") {
      alert("OpenAI API key is not configured!");
      this.updateStatus("Error: API key missing");
      return;
    }

    try {
      // Stop listening while processing
      this.stopListening();

      // Show the chat output section if it's the first message
      if (this.conversationHistory.length === 0) {
        this.showChatOutput();
      }

      // Show loading
      this.showLoading(true);
      this.updateStatus("Sending message...");

      // Add user message to conversation history
      this.conversationHistory.push({
        role: "user",
        content: question,
      });

      // Display user message
      this.appendToOutput(question, true);
      txtMsg.value = "";

      // Focus back on input for next message
      this.focusOnInput();

      this.updateStatus("Waiting for response...");
      const response = await this.callOpenAI(OPENAI_API_KEY);

      if (response?.choices[0]?.message?.content) {
        const assistantMessage = response.choices[0].message.content;

        // Add assistant response to conversation history
        this.conversationHistory.push({
          role: "assistant",
          content: assistantMessage,
        });

        this.appendToOutput(assistantMessage, false);

        // Hide loading immediately after receiving response
        this.showLoading(false);
        this.updateStatus("Response received");
        this.updateMessageCount();

        // Start speaking the response (this runs independently)
        this.textToSpeech(assistantMessage);
      } else {
        console.error("Invalid response structure:", response);
        this.appendToOutput("Error: Invalid response from ChatGPT", false);
        this.updateStatus("Error: Invalid response");
        this.showLoading(false);
        // Resume listening even on error
        this.resumeListeningIfEnabled();
      }
    } catch (error) {
      console.error("Error:", error);
      this.appendToOutput(`Error: ${error.message}`);
      this.updateStatus(`Error: ${error.message}`);
      this.showLoading(false);
      // Resume listening even on error
      this.resumeListeningIfEnabled();
    }
  }

  async callOpenAI(apiKey) {
    const selModel = document.getElementById("selModel");
    const model = selModel ? selModel.value : "gpt-3.5-turbo";

    const requestBody = {
      model: model,
      messages: this.conversationHistory,
      max_tokens: 2048,
      temperature: 0.5,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.error?.message || `HTTP error! status: ${response.status}`
      );
    }

    return await response.json();
  }

  appendToOutput(text, isUser = false) {
    if (text === null || text === undefined) {
      console.error("appendToOutput called with null/undefined text");
      text = "Error: No response received";
    }

    const chatMessages = document.getElementById("chatMessages");
    const conversationLog = document.getElementById("conversation-log");

    if (chatMessages) {
      const placeholder = chatMessages.querySelector(
        ".conversation-placeholder"
      );
      if (placeholder) {
        placeholder.remove();
      }

      const messageDiv = document.createElement("div");
      messageDiv.className = isUser ? "user-message" : "assistant-message";

      if (isUser) {
        messageDiv.innerHTML = `<div class="message-label"><strong>Me:</strong></div><div class="message-content">${this.escapeHtml(
          text
        )}</div>`;
      } else {
        const renderedHtml = this.renderMarkdown(text);
        messageDiv.innerHTML = `<div class="message-label"><strong>ChatGPT:</strong></div><div class="message-content">${renderedHtml}</div>`;

        if (typeof Prism !== "undefined") {
          setTimeout(() => Prism.highlightAllUnder(messageDiv), 0);
        }
      }

      if (isUser && chatMessages.children.length > 0) {
        const separator = document.createElement("div");
        separator.className = "message-separator";
        chatMessages.appendChild(separator);
      }

      chatMessages.appendChild(messageDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Also update the hidden textarea for compatibility/backup
    if (conversationLog) {
      const displayText = isUser ? `Me: ${text}` : `ChatGPT: ${text}`;
      if (conversationLog.value.trim() !== "") {
        conversationLog.value += "\n" + "─".repeat(50) + "\n";
      }
      conversationLog.value += displayText;
    }
  }

  async textToSpeech(text) {
    if (!this.isTextToSpeechSupported) {
      this.resumeListeningIfEnabled();
      return;
    }

    const chkMute = document.getElementById("chkMute");
    if (chkMute?.checked) {
      this.resumeListeningIfEnabled();
      return;
    }

    const plainText = this.extractPlainText(text);

    return new Promise((resolve) => {
      window.speechSynthesis.cancel();
      this.stopListening();
      this.isSpeechInProgress = true;

      this.speechSynthesisUtterance = new SpeechSynthesisUtterance(plainText);

      const selVoices = document.getElementById("selVoices");
      if (this.voices && selVoices?.value) {
        this.speechSynthesisUtterance.voice =
          this.voices[parseInt(selVoices.value)];
      }

      this.speechSynthesisUtterance.onstart = () => {
        this.updateStatus("Speaking response...");
        this.isSpeechInProgress = true;
      };

      this.speechSynthesisUtterance.onend = () => {
        this.isSpeechInProgress = false;
        this.updateStatus("Ready");
        setTimeout(() => {
          this.resumeListeningIfEnabled();
          resolve();
        }, 500);
      };

      this.speechSynthesisUtterance.onerror = (event) => {
        console.error("Speech synthesis error:", event);
        this.updateStatus("Speech error");
        this.isSpeechInProgress = false;
        setTimeout(() => {
          this.resumeListeningIfEnabled();
          resolve();
        }, 500);
      };

      const selLang = document.getElementById("selLang");
      if (selLang) {
        this.speechSynthesisUtterance.lang = selLang.value;
      }

      window.speechSynthesis.speak(this.speechSynthesisUtterance);
    });
  }

  stopListening() {
    if (this.speechRecognizer && this.isListening) {
      this.speechRecognizer.stop();
    }
    // onend will handle setting isListening to false
  }

  resumeListeningIfEnabled() {
    const chkSpeak = document.getElementById("chkSpeak");
    if (chkSpeak?.checked && !this.isListening && !this.isSpeechInProgress) {
      // Use a short delay to prevent immediate re-triggering issues
      this.speechTimeout = setTimeout(() => {
        if (this.speechRecognizer) {
          try {
            this.speechRecognizer.start();
          } catch (e) {
            // It might already be started, which is fine.
          }
        }
      }, 250);
    }
  }

  toggleMute(isMuted) {
    const selVoices = document.getElementById("selVoices");
    if (selVoices) {
      selVoices.style.display = isMuted ? "none" : "";
    }

    if (isMuted) {
      window.speechSynthesis.cancel();
      this.isSpeechInProgress = false;
      this.updateStatus("Voice muted");
      this.resumeListeningIfEnabled();
    } else {
      this.updateStatus("Voice enabled");
    }
  }

  toggleSpeechToText() {
    const chkSpeak = document.getElementById("chkSpeak");
    if (!chkSpeak) return;

    if (chkSpeak.checked) {
      if (!this.speechRecognizer) {
        this.initializeSpeechRecognition();
      }
      this.speechRecognizer.start();
      this.updateStatus("Voice input enabled");
    } else {
      this.stopListening();
      this.updateStatus("Voice input disabled");
    }
  }

  initializeSpeechRecognition() {
    if (!("webkitSpeechRecognition" in window)) {
      alert("Speech recognition not supported in this browser");
      return;
    }

    this.speechRecognizer = new webkitSpeechRecognition();
    this.speechRecognizer.continuous = true;
    this.speechRecognizer.interimResults = true;

    const selLang = document.getElementById("selLang");
    if (selLang) {
      this.speechRecognizer.lang = selLang.value;
    }

    this.speechRecognizer.onstart = () => {
      this.isListening = true;
      this.updateStatus("Listening...");
    };

    this.speechRecognizer.onresult = (event) => {
      if (this.isSpeechInProgress) return;

      let interimTranscripts = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript = transcript.trim();
        } else {
          interimTranscripts += transcript;
        }
      }

      const textDiv = document.getElementById("idText");
      if (textDiv) {
        textDiv.innerHTML = `<span style="color: #999;">${interimTranscripts}</span>`;
      }

      if (finalTranscript) {
        const txtMsg = document.getElementById("txtMsg");
        if (txtMsg) {
          txtMsg.value = finalTranscript;
          if (textDiv) textDiv.innerHTML = "";
          this.sendMessage();
        }
      }
    };

    this.speechRecognizer.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        this.updateStatus(`Speech error: ${event.error}`);
      }
    };

    this.speechRecognizer.onend = () => {
      this.isListening = false;
      this.updateStatus("Ready");
      this.resumeListeningIfEnabled(); // Always try to resume if enabled
    };
  }

  clearConversation() {
    this.conversationHistory = [];
    const conversationLog = document.getElementById("conversation-log");
    if (conversationLog) {
      conversationLog.value = "";
    }

    const chatMessages = document.getElementById("chatMessages");
    if (chatMessages) {
      chatMessages.innerHTML =
        '<div class="conversation-placeholder">Start a conversation by typing or using voice...</div>';
    }

    this.hideChatOutput();
    this.updateMessageCount();
    this.updateStatus("Conversation cleared");
    this.focusOnInput();
  }

  // Utility methods for UI updates
  showLoading(show = true) {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) {
      overlay.style.display = show ? "flex" : "none";
    }
  }

  updateStatus(text) {
    const statusText = document.getElementById("statusText");
    if (statusText) {
      statusText.textContent = text;
    }
  }

  updateMessageCount() {
    const messageCount = document.getElementById("messageCount");
    if (messageCount) {
      const count = Math.floor(this.conversationHistory.length / 2);
      messageCount.textContent = `Messages: ${count}`;
    }
  }
}

// Initialize the ChatGPT client
let chatGPTClient;

// Updated function names for backward compatibility
function OnLoad() {
  chatGPTClient = new ChatGPTClient();
  initializeSettingsPanel();
}

function ChangeLang(selectElement) {
  if (chatGPTClient) {
    chatGPTClient.changeLang(selectElement.value);
  }
}

function Send() {
  if (chatGPTClient) {
    chatGPTClient.sendMessage();
  }
  
  const { panel } = getSettingsElements();
  if (panel?.classList.contains("expanded")) {
    toggleSettings();
  }
}

function TextToSpeech(text) {
  if (chatGPTClient) {
    chatGPTClient.textToSpeech(text);
  }
}

function Mute(isMuted) {
  if (chatGPTClient) {
    chatGPTClient.toggleMute(isMuted);
  }
}

function SpeechToText() {
  if (chatGPTClient) {
    chatGPTClient.toggleSpeechToText();
  }
}

function ClearConversation() {
  if (chatGPTClient) {
    chatGPTClient.clearConversation();
  }
}

// Additional helper functions for the HTML
function handleKeyPress(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    Send();
  }
}

function showLoading(show = true) {
  if (chatGPTClient) {
    chatGPTClient.showLoading(show);
  }
}

function updateStatus(text) {
  if (chatGPTClient) {
    chatGPTClient.updateStatus(text);
  }
}

function updateMessageCount() {
  if (chatGPTClient) {
    chatGPTClient.updateMessageCount();
  }
}

// Initialize when DOM is loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", OnLoad);
} else {
  OnLoad();
}

// Add some additional error handling for the page
window.addEventListener("error", (event) => {
  console.error("Global error:", event.error);
  if (chatGPTClient) {
    chatGPTClient.updateStatus("Application error occurred");
    chatGPTClient.showLoading(false);
  }
});

// Handle unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  if (chatGPTClient) {
    chatGPTClient.updateStatus("Network error occurred");
    chatGPTClient.showLoading(false);
  }
});

// Additional cleanup when page unloads
window.addEventListener("beforeunload", () => {
  if (chatGPTClient) {
    chatGPTClient.stopListening();
    window.speechSynthesis.cancel();
  }
});

function getSettingsElements() {
  return {
    panel: document.getElementById("settingsPanel"),
    content: document.getElementById("settingsContent"),
    toggle: document.getElementById("settingsToggle"),
    icon: document.getElementById("settingsIcon"),
  };
}

// Settings panel toggle functionality
function toggleSettings() {
  const { panel, content, toggle, icon } = getSettingsElements();
  if (!panel || !content || !toggle || !icon) return;

  content.classList.toggle("expanded");
  toggle.classList.toggle("expanded");
  panel.classList.toggle("minimized");
  panel.classList.toggle("expanded");
  icon.className = content.classList.contains("expanded")
    ? "fas fa-times"
    : "fas fa-cog";
}

// Initialize settings panel as minimized
function initializeSettingsPanel() {
  const { panel, content } = getSettingsElements();
  if (!panel || !content) return;

  panel.classList.add("minimized");
  content.classList.remove("expanded");
}

// Minimize on click outside
document.addEventListener("mousedown", (event) => {
  const { panel, content } = getSettingsElements();
  if (!panel || !content) return;

  if (content.classList.contains("expanded") && !panel.contains(event.target)) {
    toggleSettings();
  }
});