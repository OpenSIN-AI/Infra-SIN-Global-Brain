import asyncio
import logging
import random
from input.human_mouse import human_click

logger = logging.getLogger(__name__)

class SafeExecutor:
    @staticmethod
    async def click_target(bot, target_text: str, timeout: int = 10):
        """
        Versucht, ein Ziel zu klicken, mit mehreren Strategien und Timeouts.
        """
        logger.info(f"🎯 Suche nach Ziel: '{target_text}'")
        
        strategies = [
            ("Vision OCR", lambda: bot.click(target_text, vision=True)),
            ("DOM Selector", lambda: bot.click(target_text, vision=False)),
            ("Iframe Scan", lambda: SafeExecutor._scan_iframes(bot, target_text)),
            ("JS Force Click", lambda: SafeExecutor._js_force_click(bot, target_text))
        ]
        
        for name, strategy_func in strategies:
            try:
                logger.debug(f"Versuche Strategie: {name}")
                # Wichtig: Timeout für jede Strategie, damit der Bot nicht hängt
                success = await asyncio.wait_for(strategy_func(), timeout=timeout)
                if success:
                    logger.info(f"✅ Erfolg via {name}")
                    return True
            except asyncio.TimeoutError:
                logger.warning(f"⏳ Timeout bei Strategie: {name}")
            except Exception as e:
                logger.debug(f"❌ Fehler bei {name}: {e}")
            
            await asyncio.sleep(random.uniform(0.5, 1.5)) # Pause zwischen Versuchen
            
        logger.error(f"❌ Alle Strategien fehlgeschlagen für: '{target_text}'")
        return False

    @staticmethod
    async def _scan_iframes(bot, text):
        """Rekursive Suche in Iframes."""
        for frame in bot.page.frames:
            try:
                # Suche nach Element mit Text oder ARIA-Label
                el = await frame.find(text, best_match=True)
                if not el:
                    # Fallback: Suche nach Button mit aria-label
                    el = await frame.select(f'button[aria-label*="{text}"], a[aria-label*="{text}"]')
                
                if el:
                    box = await el.get_bounding_box()
                    if box:
                        center_x = box.x + box.width / 2
                        center_y = box.y + box.height / 2
                        await human_click(bot.page, center_x, center_y)
                        return True
            except Exception:
                continue
        return False

    @staticmethod
    async def _js_force_click(bot, text):
        """Letzter Ausweg: JavaScript Injection."""
        script = f"""
        (() => {{
            const elements = Array.from(document.querySelectorAll('button, a, input[type="submit"], span'));
            const target = elements.find(el => 
                el.textContent.includes('{text}') || 
                el.getAttribute('aria-label')?.includes('{text}')
            );
            if (target) {{
                target.scrollIntoView();
                target.click();
                return true;
            }}
            return false;
        }})()
        """
        return await bot.page.evaluate(script)
