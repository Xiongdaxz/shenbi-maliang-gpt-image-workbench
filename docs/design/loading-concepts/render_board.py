"""Render the loading concept board using the existing, unmodified brand logo."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import base64

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
VIZ = Path('C:/Users/PC/.codex/visualizations/2026/09/28/01a0e5e5-596f-7343-ab54-783a87ee5b00/logo-loading-concepts.html')
FONT = 'C:/Windows/Fonts/msyh.ttc'
BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
im = Image.new('RGBA', (1800, 1200), '#f5f5f3')
d = ImageDraw.Draw(im)
logo = Image.open(ROOT / 'public/image/logo.png').convert('RGBA')

def text(x, y, value, size=22, fill='#252831', bold=False, center=False):
    font = ImageFont.truetype(BOLD if bold else FONT, size)
    if center:
        x -= d.textlength(value, font=font) / 2
    d.text((x, y), value, font=font, fill=fill)

def mark(cx, cy, size, glow=False, opacity=1):
    if glow:
        factor=size/136
        for color,box,alpha in [('#74cfff',(-86,-45,15,56),65),('#f9a3d3',(-12,-40,78,52),60),('#ffd280',(-35,-75,55,10),55)]:
            mask=Image.new('L',im.size)
            ImageDraw.Draw(mask).ellipse((cx+box[0]*factor,cy+box[1]*factor,cx+box[2]*factor,cy+box[3]*factor),fill=alpha)
            layer=Image.new('RGBA',im.size,color)
            layer.putalpha(mask.filter(ImageFilter.GaussianBlur(25*factor)))
            im.alpha_composite(layer)
    asset=logo.resize((size,size),Image.Resampling.LANCZOS)
    if opacity<1:
        asset.putalpha(asset.getchannel('A').point(lambda a:int(a*opacity)))
    im.alpha_composite(asset,(int(cx-size/2),int(cy-size/2)))

text(72,54,'MALIANG  /  LOADING STUDY',18,'#777e87')
text(72,97,'让 Logo 轻轻呼吸，让等待有回应。',44,bold=True)
text(74,165,'神笔马良 · 页面加载动效提案',23,'#737782')
text(1728,65,'01—03',18,'#777e87',center=False)

variants=[
    ('A','极简呼吸','只保留 Logo 与一句状态提示','安静、轻量，最接近现在的页面。','2.4 秒 / 轮','透明度 + 轻微缩放'),
    ('B','柔光呼吸','Logo 呼吸，淡彩光晕同步起伏','有品牌感，适合作为默认加载页。','2.4 秒 / 轮','淡彩柔光 + 轻微缩放'),
    ('C','笔迹流光','Logo 轻轻悬浮，彩色笔迹流过','更有创作氛围，动感也更明显。','2.8 秒 / 轮','轻微悬浮 + 循环笔迹'),
]
for i,(key,name,subtitle,desc,cycle,effect) in enumerate(variants):
    x=72+i*566; w=524; cx=x+w/2
    d.rounded_rectangle((x,234,x+w,1018),radius=22,fill='#ffffff',outline='#dedfe1' if i!=1 else '#ccbca6',width=1 if i!=1 else 2)
    text(x+28,260,key,18,'#8a8c93')
    text(x+66,251,name,28,bold=True)
    if i==1:
        d.rounded_rectangle((x+w-98,255,x+w-27,288),radius=16,fill='#f4eee4')
        text(x+w-63,260,'推荐',16,'#89662f',center=True)
    text(x+28,302,subtitle,18,'#797d85')
    d.rounded_rectangle((x+22,354,x+w-22,698),radius=12,fill='#fcfcfc')
    d.line((x+36,382,x+w-36,382),fill='#efeff0',width=1)
    for dot in range(3):
        d.ellipse((x+37+dot*13,366,x+42+dot*13,371),fill='#dddfe2')
    mark(cx,488,136,glow=i==1)
    if i==0:
        text(cx,580,'加载中…',17,'#888b92',center=True)
    else:
        if i==2:
            d.rounded_rectangle((cx-65,566,cx+65,570),radius=2,fill='#e9e9ed')
            colors=['#73cff4','#90baf2','#b49de9','#d99edc','#efabd0','#edc38a']
            for n,c in enumerate(colors):
                d.line((cx-35+n*11,568,cx-25+n*11,568),fill=c,width=3)
        text(cx,589 if i==2 else 570,'神笔马良',21,'#33343b',center=True)
        text(cx,625 if i==2 else 607,'正在加载工作台',16,'#888b92',center=True)
    text(x+28,725,desc,19,'#424650')
    text(x+28,760,cycle+'   ·   '+effect,17,'#858991')
    d.line((x+28,811,x+w-28,811),fill='#eeeff1',width=1)
    text(x+28,830,'动效关键帧',15,'#8a8e96')
    for j,label in enumerate(['呼气','吸气','呼气'] if i<2 else ['起笔','流过','淡出']):
        fx=x+100+j*162
        mark(fx,915,66 if j!=1 else 75,glow=i==1,opacity=.75 if j!=1 and i<2 else 1)
        if i==2:
            d.line((fx-31,954,fx+31,954),fill='#e8e8ed',width=2)
            d.line((fx-31+j*18,954,fx-13+j*18,954),fill=['#78cdf5','#ba9ae6','#eec58a'][j],width=3)
        text(fx,965,label,15,'#8a8e96',center=True)

text(74,1060,'建议采用 B · 柔光呼吸',24,bold=True)
text(74,1104,'缩放保持在 96%—104%  ·  加载完成立即进入  ·  跟随浅色 / 深色主题  ·  支持减少动态效果',20,'#757982')
im.convert('RGB').save(OUT/'loading-concepts.png')
fragment=VIZ.read_text(encoding='utf-8')
encoded=base64.b64encode((ROOT/'public/image/logo-small.webp').read_bytes()).decode('ascii')
VIZ.write_text(fragment.replace('__LOGO_DATA__','data:image/webp;base64,'+encoded),encoding='utf-8')
print(OUT/'loading-concepts.png')
print(f'Visualization: {VIZ.stat().st_size} bytes')
