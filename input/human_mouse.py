import random
import numpy as np
from scipy.interpolate import interp1d

def _apply_physiologic_tremor(pts: list[tuple]) -> list[tuple]:
    """Simuliert physiologischen Tremor (8-12 Hz)."""
    vibrated = []
    for i, (x, y) in enumerate(pts):
        if i == 0 or i == len(pts) - 1:
            vibrated.append((x, y))
            continue
        # Kleines Zittern
        tx = x + random.gauss(0, 0.3)  # Gauss statt Uniform für natürlichere Verteilung
        ty = y + random.gauss(0, 0.3)
        vibrated.append((tx, ty))
    return vibrated

def generate_human_curve(start, end, n_steps=50):
    """Erzeugt eine Bezier-Kurve mit menschlicher Beschleunigung."""
    # Kontrollpunkte für natürliche Kurve
    ctrl1 = (start[0] + (end[0] - start[0]) * 0.3, start[1] + (end[1] - start[1]) * 0.1)
    ctrl2 = (start[0] + (end[0] - start[0]) * 0.7, end[1] + (start[1] - end[1]) * 0.1)
    
    t = np.linspace(0, 1, n_steps)
    # Kubische Bezier Formel
    x = (1-t)**3 * start[0] + 3*(1-t)**2*t * ctrl1[0] + 3*(1-t)*t**2 * ctrl2[0] + t**3 * end[0]
    y = (1-t)**3 * start[1] + 3*(1-t)**2*t * ctrl1[1] + 3*(1-t)*t**2 * ctrl2[1] + t**3 * end[1]
    
    points = list(zip(x, y))
    points = _apply_physiologic_tremor(points)
    return points

async def human_click(page, x, y):
    """Führt einen Klick mit menschlicher Bewegung aus."""
    import asyncio
    
    # Aktuelle Mausposition holen (simuliert)
    current_pos = await page.evaluate("({x: window.screenX + window.innerWidth/2, y: window.screenY + window.innerHeight/2})")
    
    curve = generate_human_curve((current_pos['x'], current_pos['y']), (x, y))
    
    for px, py in curve:
        await page.mouse.move(px, py)
        await asyncio.sleep(random.gauss(0.01, 0.005)) # Variable Geschwindigkeit
    
    await page.mouse.click()
    await asyncio.sleep(random.gauss(0.2, 0.1)) # Nach dem Klick kurz warten
