import asyncio
import logging
from core.browser import StealthBrowser
from core.executor import SafeExecutor
from core.anti_captcha import clean_path

# Logging konfigurieren
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def run_unbeatable_agent():
    bot = None
    try:
        bot = StealthBrowser()
        # Profil laden (oder neu erstellen, wenn nicht existiert)
        await bot.start(profile_name="agent_main") 
        
        # 1. Stealth Check (Optional, aber empfohlen)
        await bot.check_stealth()
        
        # 2. Navigation
        target_url = "https://chat.openai.com"
        logger.info(f"🌐 Navigiere zu {target_url}")
        await bot.goto(target_url)
        
        # 3. Pfad säubern (Captchas/Banner)
        await clean_path(bot)
        
        # 4. Interaktion mit Self-Healing Logic
        if await SafeExecutor.click_target(bot, "Log in"):
            logger.info("Login-Button gefunden. Warte...")
            await bot.think(2, 4) # Menschliche Pause
            
            # E-Mail eingeben
            await bot.type("deine@email.com", selector="input[type='email']")
            await SafeExecutor.click_target(bot, "Continue")
            await bot.think(2, 4)
            
            # Passwort eingeben
            await bot.type("dein_sicheres_passwort", selector="input[type='password']")
            await SafeExecutor.click_target(bot, "Continue")
            
            logger.info("✅ Login-Prozess abgeschlossen.")
        else:
            logger.error("❌ Konnte Login-Flow nicht starten.")
            await bot.screenshot("error_login_flow.png")

        # 5. Session speichern für nächsten Lauf
        await bot.save_session()
        
    except Exception as e:
        logger.critical(f"💥 Kritischer Fehler: {e}", exc_info=True)
        if bot:
            await bot.screenshot("crash_state.png")
    finally:
        if bot:
            await bot.close()
            logger.info("🔒 Browser geschlossen.")

if __name__ == "__main__":
    asyncio.run(run_unbeatable_agent())
