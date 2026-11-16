"""Generate the original SealBox SVG artwork. Python standard library only."""
from pathlib import Path
from html import escape

OUT = Path(__file__).parent / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
BG, PANEL, LINE, FG, MUTED, ACCENT = '#171225', '#241c36', '#48365f', '#f5f0ff', '#bfb1d2', '#c4a0ff'

def text(x, y, content, size=24, fill=FG, weight=400, extra=''):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" font-weight="{weight}" {extra}>{escape(content)}</text>'

def rect(x,y,w,h,fill=PANEL,rx=20,stroke=LINE):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}"/>'

def mark(x,y,scale=1):
    return f'''<g transform="translate({x} {y}) scale({scale})" stroke-linejoin="round">
    <path d="M100 8 184 56 184 154 100 202 16 154 16 56Z" fill="{PANEL}" stroke="{ACCENT}" stroke-width="3"/>
    <path d="M16 56 100 105 184 56M100 105V202" fill="none" stroke="{ACCENT}" stroke-width="3"/>
    <path d="m57 32 85 49v42l-29 17V98L29 49Z" fill="{ACCENT}"/>
    <path d="m64 126 15 9v28l-15-9Z" fill="{FG}"/>
    </g>'''

def svg(name,w,h,body,title,desc):
    (OUT/name).write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">
<title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc>
<g font-family="DejaVu Sans, Arial, sans-serif">{body}</g></svg>''')

def hero(lang, social=False):
    ru=lang=='ru'; w,h=(1280,640) if social else (1440,640)
    b=rect(0,0,w,h,BG,0,BG)
    for x in range(32,w,48):
        for y in range(32,h,48): b+=f'<circle cx="{x}" cy="{y}" r="1" fill="{LINE}" opacity=".6"/>'
    b+=text(72,75,'OBSIDIAN  /  LOCAL ENCRYPTION',15,ACCENT,600, 'letter-spacing="3"')
    b+=text(68,205,'SealBox',108,FG,700,'letter-spacing="-5"')
    lines=['Личное остаётся личным.','Даже внутри вашего vault.'] if ru else ['Your vault.','Your private space.']
    b+=text(76,284,lines[0],34)+text(76,330,lines[1],34)
    b+=text(76,391,'Заметки, вложения и секреты — под одним паролем.' if ru else 'Notes, attachments and secrets. One password.',19,MUTED)
    b+=rect(76,438,136,36,ACCENT,18,ACCENT)+text(96,462,'.sealed',18,BG,600)
    b+=text(234,462,'Desktop + Android',17,MUTED)
    b+=mark(w-370,155,1.35)
    b+=text(w-356,496,'AES-256-GCM',18,ACCENT,500,'letter-spacing="2"')
    b+=f'<path d="M76 548H{w-76}" stroke="{LINE}"/>'
    b+=text(76,588,'Шифрование на устройстве · Без аккаунта' if ru else 'On-device encryption · No account required',16,MUTED)
    b+=text(w-76,588,'OPEN SOURCE / MIT',14,MUTED,400,'text-anchor="end" letter-spacing="2"')
    svg(('social-preview' if social else 'hero-'+lang)+'.svg',w,h,b,'SealBox — '+lines[0],'SealBox Obsidian plugin: encrypted notes, attachments and secrets, on desktop and Android.')

hero('en'); hero('ru'); hero('en',True)
svg('logo.svg',256,256,rect(0,0,256,256,BG,48,BG)+mark(28,22), 'SealBox logo','A geometric box closed with a lavender coloured seal.')
svg('logo-transparent.svg',224,224,mark(12,7), 'SealBox logo, transparent','Geometric sealed box on a transparent background.')

for lang in ['en','ru']:
    ru=lang=='ru'
    b=rect(0,0,1440,590,BG,0,BG)+text(56,64,'Меньше действий. Больше приватности.' if ru else 'A private space, inside your vault.',34,FG,600)
    cards=[('01','Заметки' if ru else 'Notes', ['Редактируйте внутри SealBox.','Сохраняйте в формате .sealed.'] if ru else ['Edit inside SealBox.','Save as an encrypted .sealed file.']),('02','Вложения' if ru else 'Attachments',['Просматривайте изображения и PDF.','Шифруйте файлы любого типа.'] if ru else ['View images and PDFs.','Encrypt any file type.']),('03','Секреты' if ru else 'Secrets',['Логины, теги и свои поля.','Шаблоны для разных записей.'] if ru else ['Logins, tags and custom fields.','Templates for different entries.'])]
    for i,(n,title,lines) in enumerate(cards):
        x=56+i*448
        b+=rect(x,108,432,278)+text(x+28,154,n,18,ACCENT,500)+text(x+28,228,title,32,FG,600)
        for j,line in enumerate(lines): b+=text(x+28,286+j*31,line,18,MUTED)
    b+=text(56,454,'ОДНА СЕССИЯ' if ru else 'ONE SESSION',14,ACCENT,600,'letter-spacing="2"')
    b+=text(56,492,'Разблокируйте один раз. Открывайте нужные файлы.' if ru else 'Unlock once. Open the files you need.',26)
    b+=text(56,543,'Ключ восстановления · Русский и английский · Desktop и Android' if ru else 'Recovery key · English and Russian · Desktop and Android',18,MUTED)
    svg('features-'+lang+'.svg',1440,590,b,'SealBox features','Notes, attachments and secrets in encrypted containers. One unlock per session, recovery keys, English and Russian.')

    b=rect(0,0,1440,790,BG,0,BG)+text(56,66,'Как защищены ваши файлы' if ru else 'How your files are protected',34,FG,600)
    b+=text(56,108,'Упрощённая схема · Обычный режим с мастер-ключом' if ru else 'Simplified overview · Standard vault-keyed mode',18,MUTED)
    nodes=[(56,184,360,'01','Мастер-пароль' if ru else 'Master password','Argon2id / PBKDF2-SHA512'),(540,184,360,'02','Мастер-ключ' if ru else 'Master key','256-bit · random'),(1024,184,360,'03','Ключ файла' if ru else 'File key','HKDF-SHA256 · unique salt')]
    for x,y,w,n,title,sub in nodes:
        b+=rect(x,y,w,158)+text(x+24,y+36,n,15,ACCENT)+text(x+24,y+81,title,26,FG,600)+text(x+24,y+119,sub,17,MUTED)
    def arrow(x1,y1,x2,y2):
        return f'<path d="M{x1} {y1}H{x2-10}" fill="none" stroke="{ACCENT}" stroke-width="2"/><path d="m{x2-16} {y2-6} 8 6-8 6" fill="none" stroke="{ACCENT}" stroke-width="2"/>'
    b+=arrow(428,263,528,263)+arrow(912,263,1012,263)
    b+=text(435,240,'unwrap',13,MUTED)+text(922,240,'derive',13,MUTED)
    b+=rect(540,402,360,128)+text(564,448,'Ключ восстановления' if ru else 'Recovery key',24,FG,600)+text(564,486,'Второй путь к мастер-ключу' if ru else 'Another way to unwrap the key',16,MUTED)
    b+=f'<path d="M720 402V354" stroke="{ACCENT}" stroke-width="2"/><path d="m714 363 6-8 6 8" fill="none" stroke="{ACCENT}" stroke-width="2"/>'
    b+=rect(1024,402,360,128,ACCENT,20,ACCENT)+text(1048,449,'.sealed',32,BG,600)+text(1048,487,'AES-256-GCM · 1 MiB chunks',17,BG)
    b+=f'<path d="M1204 354V389" stroke="{ACCENT}" stroke-width="2"/><path d="m1198 381 6 8 6-8" fill="none" stroke="{ACCENT}" stroke-width="2"/>'
    b+=text(56,601,'На диске — шифртекст. При открытии — расшифровка в памяти.' if ru else 'Ciphertext on disk. Decrypted content in memory when opened.',25)
    b+=text(56,650,'Имена файлов, размеры и структура папок остаются видимыми.' if ru else 'File names, sizes and folder structure remain visible.',18,MUTED)
    b+=text(56,688,'Защита данных в покое; не защищает от вредоносного ПО на устройстве.' if ru else 'Protects data at rest; does not protect against malware on the device.',18,MUTED)
    b+=text(56,741,'Схема не показывает все этапы HKDF, AAD и дополнительные режимы.' if ru else 'Diagram omits intermediate HKDF steps, AAD and optional modes.',15,MUTED)
    svg('encryption-'+lang+'.svg',1440,790,b,'SealBox encryption overview','Password unwraps a random master key. HKDF derives file keys. AES-256-GCM encrypts chunked sealed files. Recovery key independently unwraps the master key.')

print(f'Generated {len(list(OUT.glob("*.svg")))} SVG assets in {OUT}')
