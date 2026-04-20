import asyncio
import json
import logging
from input.human_mouse import human_click

logger = logging.getLogger(__name__)

async def clean_path(bot):
    """Beseitigt Hindernisse wie Captchas und Cookie-Banner."""
    
    # 1. Cloudflare Turnstile
    for frame in bot.page.frames:
        if "turnstile" in frame.url.lower():
            logger.info("🛡️ Turnstile erkannt.")
            try:
                # Versuche, die Checkbox zu finden und zu klicken
                box_json = await frame.evaluate("""
                    JSON.stringify(document.querySelector('.ctp-checkbox-container')?.getBoundingClientRect())
                """)
                if box_json and box_json != "null":
                    box = json.loads(box_json)
                    await human_click(bot.page, box['left'] + 10, box['top'] + 10)
                    await asyncio.sleep(4) # Warten auf Lösung
                    return
            except Exception as e:
                logger.debug(f"Turnstile Klick fehlgeschlagen: {e}")

    # 2. hCaptcha (Falls vorhanden)
    for frame in bot.page.frames:
        if "hcaptcha" in frame.url.lower():
            logger.info("🤖 hCaptcha erkannt. (Manuelle Intervention oder Solver nötig)")
            # Hinweis: hCaptcha ist schwer automatisch zu lösen ohne externen Service
            await asyncio.sleep(10) 

    # 3. Cookie Banner Killer
    cookie_texts = ["Akzeptieren", "Zustimmen", "Accept", "Agree", "Alle akzeptieren", "Allow all"]
    for txt in cookie_texts:
        try:
            el = await bot.page.find(txt, timeout=2)
            if el:
                await el.click()
                logger.info(f"🧹 Cookie-Banner '{txt}' entfernt.")
                await asyncio.sleep(1)
                break # Nur einen Banner entfernen
        except:
            continue
