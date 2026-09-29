import type { LocaleCode } from "../locales";
import type { Messages } from "./types";

const keys = [
  "title", "count", "start", "selectHint", "limitHint", "resume", "back", "description", "controls", "sync",
  "fit", "actual", "zoomOut", "zoomIn", "fitScale", "pixelScale", "fitValue", "pixelValue", "original", "preview",
  "info", "current", "image", "favorite", "unfavorite", "save", "saved", "unavailable", "loadFailed", "originalReady",
  "originalLoading", "previewReady", "retryOriginal", "tooFew", "someUnavailable", "removeUnavailable", "switchSlot", "copyPrompt", "active", "edit",
  "help.title", "help.summary", "help.keywords", "help.body"
] as const;

const translations: Record<LocaleCode, readonly string[]> = {
  "zh-CN": [
    "选图对比", "{count} 张", "对比（{count}）", "请选择 2～4 张图片进行对比", "一次最多对比 4 张，请减少选择", "继续对比（{count}）", "返回选图", "比较图片，支持同步缩放、收藏、下载和继续编辑。", "对比工具", "同步查看",
    "适应", "原图 1:1", "缩小", "放大", "适应倍率", "原图比例", "适应 {value}×", "原图 {value}%", "原图", "预览",
    "信息", "当前", "图片 {label}", "收藏图片 {label}", "取消收藏图片 {label}", "收藏", "已收藏", "图片不可用", "图片加载失败", "原图已就绪",
    "原图加载中", "当前为预览图", "重试原图", "有效图片不足 2 张，请返回选图", "部分图片已不可用", "移除不可用项", "切换当前观察窗", "复制提示词", "当前图片 {label}", "继续编辑",
    "如何并排对比图片？", "选择 2～4 张图片，同步查看细节并收藏满意结果。", "对比 选图 同步 缩放 原图 收藏", "在「我的图片」点击「批量管理」，勾选 2～4 张图片后点击「对比」。图片可以来自不同聊天。\n\n默认同步查看。拖动或缩放任意图片，其他图跟随相对位置和倍率；关闭同步后可分别查看。「适应」完整展示图片，「1:1」加载原图并按图像像素查看。每格会提示原图是否加载完成。\n\n点击图片编号选中当前图，可收藏、查看和复制提示词、下载或继续编辑。收藏长期保存；本轮对比可在同一标签页刷新恢复；从批量工具栏再次对比同一组图片可继续查看，退出账号会清除。手机同时显示两张，通过编号缩略图切换当前观察窗。"
  ],
  "zh-TW": [
    "選圖對比", "{count} 張", "對比（{count}）", "請選擇 2～4 張圖片進行對比", "一次最多對比 4 張，請減少選擇", "繼續對比（{count}）", "返回選圖", "比較圖片，支援同步縮放、收藏、下載和繼續編輯。", "對比工具", "同步檢視",
    "適應", "原圖 1:1", "縮小", "放大", "適應倍率", "原圖比例", "適應 {value}×", "原圖 {value}%", "原圖", "預覽",
    "資訊", "目前", "圖片 {label}", "收藏圖片 {label}", "取消收藏圖片 {label}", "收藏", "已收藏", "圖片無法使用", "圖片載入失敗", "原圖已就緒",
    "原圖載入中", "目前為預覽圖", "重試原圖", "有效圖片不足 2 張，請返回選圖", "部分圖片已無法使用", "移除無效項目", "切換目前檢視窗", "複製提示詞", "目前圖片 {label}", "繼續編輯",
    "如何並排對比圖片？", "選擇 2～4 張圖片，同步檢視細節並收藏滿意結果。", "對比 選圖 同步 縮放 原圖 收藏", "在「我的圖片」點擊「批量管理」，勾選 2～4 張圖片後點擊「對比」。圖片可以來自不同聊天。\n\n預設同步檢視。拖動或縮放任意圖片，其他圖跟隨相對位置和倍率；關閉同步後可分別檢視。「適應」完整展示圖片，「1:1」載入原圖並按圖像像素檢視。每格會提示原圖是否載入完成。\n\n點擊圖片編號選中目前圖片，可收藏、檢視及複製提示詞、下載或繼續編輯。收藏長期保存；本輪對比可在同一分頁重新整理恢復；從批量工具列再次對比同一組圖片可繼續檢視，登出帳號會清除。手機同時顯示兩張，透過編號縮圖切換目前檢視窗。"
  ],
  "en-US": [
    "Compare images", "{count} images", "Compare ({count})", "Select 2–4 images to compare", "Compare up to 4 images; reduce your selection", "Resume comparison ({count})", "Back to selection", "Compare images with linked zoom, favorites, downloads, and editing.", "Comparison controls", "Link views",
    "Fit", "Original at 1:1", "Zoom out", "Zoom in", "Zoom relative to fit", "Original pixel scale", "Fit {value}×", "Original {value}%", "Original", "Preview",
    "Info", "Current", "Image {label}", "Favorite image {label}", "Unfavorite image {label}", "Favorite", "Favorited", "Image unavailable", "Image failed to load", "Original ready",
    "Loading original", "Showing preview", "Retry original", "Fewer than 2 images available. Return to selection.", "Some images are unavailable", "Remove unavailable", "Switch current pane", "Copy prompt", "Current image {label}", "Continue editing",
    "How do I compare images side by side?", "Compare 2–4 images, inspect details together, and favorite your choices.", "compare select linked zoom original favorites", "In My Images, open Batch manage, select 2–4 images, then choose Compare. Images may come from different chats.\n\nViews are linked by default: dragging or zooming one image updates the relative position and zoom of the others. Unlink to inspect independently. Fit shows the whole image; 1:1 loads the original at image-pixel scale. Each pane shows whether the original has loaded.\n\nSelect an image by its letter to view or copy its prompt, download, favorite, or continue editing. Favorites are saved to your account. Refresh the comparison page to restore its draft in the same tab. To continue from the gallery, select the same images and use Compare in Batch manage; signing out clears the draft. On phones, two panes are shown; lettered thumbnails switch the current pane."
  ],
  "ja-JP": [
    "画像を比較", "{count} 枚", "比較（{count}）", "比較する画像を2～4枚選択してください", "比較は最大4枚です。選択を減らしてください", "比較を再開（{count}）", "画像選択に戻る", "拡大・移動を連動させ、画像を比較、保存、ダウンロード、編集します。", "比較ツール", "表示を連動",
    "全体表示", "原寸 1:1", "縮小", "拡大", "全体表示からの倍率", "原寸に対する倍率", "全体 {value}×", "原寸 {value}%", "元画像", "プレビュー",
    "情報", "選択中", "画像 {label}", "画像 {label} をお気に入りに追加", "画像 {label} のお気に入りを解除", "お気に入り", "登録済み", "画像を利用できません", "画像の読み込みに失敗しました", "元画像を読み込み済み",
    "元画像を読み込み中", "プレビューを表示中", "元画像を再読み込み", "利用できる画像が2枚未満です。選択に戻ってください", "一部の画像を利用できません", "利用できない画像を除外", "選択中の枠を切り替え", "プロンプトをコピー", "選択中の画像 {label}", "編集を続ける",
    "画像を並べて比較するには？", "2～4枚の画像を比較し、細部を確認してお気に入りを選びます。", "比較 選択 連動 拡大 元画像 お気に入り", "「マイ画像」の一括管理で2～4枚を選択し、「比較」を押します。異なるチャットの画像も選べます。\n\n初期状態では表示が連動します。ドラッグや拡大で各画像の相対位置と倍率が変わります。連動を解除すると個別に操作できます。「全体表示」は画像全体、「1:1」は元画像の画素単位の表示です。読み込み状態は各枠に表示されます。\n\n画像の文字を選ぶと、プロンプトの表示・コピー、ダウンロード、お気に入り登録、編集ができます。お気に入りはアカウントに保存されます。比較は同じタブで再開でき、ログアウト時に消去されます。スマートフォンでは2枠を表示し、文字付きサムネイルで切り替えます。"
  ],
  "ko-KR": [
    "이미지 비교", "{count}장", "비교 ({count})", "비교할 이미지를 2~4장 선택하세요", "최대 4장까지 비교할 수 있습니다", "비교 계속하기 ({count})", "이미지 선택으로", "확대와 이동을 연결하여 이미지를 비교하고 즐겨찾기, 다운로드, 편집합니다.", "비교 도구", "보기 연결",
    "화면에 맞춤", "원본 1:1", "축소", "확대", "화면 맞춤 기준 배율", "원본 픽셀 배율", "맞춤 {value}×", "원본 {value}%", "원본", "미리보기",
    "정보", "현재", "이미지 {label}", "이미지 {label} 즐겨찾기", "이미지 {label} 즐겨찾기 해제", "즐겨찾기", "저장됨", "이미지를 사용할 수 없음", "이미지를 불러오지 못했습니다", "원본 준비됨",
    "원본 불러오는 중", "미리보기 표시 중", "원본 다시 시도", "사용 가능한 이미지가 2장 미만입니다. 선택으로 돌아가세요", "일부 이미지를 사용할 수 없습니다", "사용 불가 항목 제외", "현재 보기 창 전환", "프롬프트 복사", "현재 이미지 {label}", "계속 편집",
    "이미지를 나란히 비교하려면?", "이미지 2~4장의 세부 사항을 함께 보고 마음에 드는 결과를 저장합니다.", "비교 선택 연결 확대 원본 즐겨찾기", "내 이미지의 일괄 관리에서 2~4장을 선택하고 비교를 누르세요. 다른 채팅의 이미지도 비교할 수 있습니다.\n\n기본적으로 보기가 연결됩니다. 한 이미지를 이동하거나 확대하면 다른 이미지도 상대 위치와 배율을 따릅니다. 연결을 해제하면 개별 조작이 가능합니다. 화면에 맞춤은 전체 이미지를, 1:1은 원본 픽셀 크기를 표시합니다. 각 창에 원본 로딩 상태가 표시됩니다.\n\n문자 번호를 선택하여 프롬프트 확인·복사, 다운로드, 즐겨찾기, 편집을 할 수 있습니다. 즐겨찾기는 계정에 저장됩니다. 비교는 같은 탭에서 다시 열 수 있으며 로그아웃하면 지워집니다. 휴대폰에서는 두 창을 표시하며 문자 썸네일로 현재 창을 전환합니다."
  ],
  "es-ES": [
    "Comparar imágenes", "{count} imágenes", "Comparar ({count})", "Selecciona de 2 a 4 imágenes", "Reduce la selección a un máximo de 4 imágenes", "Continuar comparación ({count})", "Volver a seleccionar", "Compara imágenes con zoom vinculado, favoritos, descarga y edición.", "Herramientas de comparación", "Vincular vistas",
    "Ajustar", "Original 1:1", "Alejar", "Acercar", "Zoom relativo al ajuste", "Escala de píxeles originales", "Ajuste {value}×", "Original {value}%", "Original", "Vista previa",
    "Información", "Actual", "Imagen {label}", "Guardar imagen {label} en favoritos", "Quitar imagen {label} de favoritos", "Favorito", "Guardada", "Imagen no disponible", "No se pudo cargar la imagen", "Original disponible",
    "Cargando original", "Mostrando vista previa", "Reintentar original", "Hay menos de 2 imágenes disponibles. Vuelve a seleccionar.", "Algunas imágenes no están disponibles", "Quitar no disponibles", "Cambiar panel actual", "Copiar prompt", "Imagen actual {label}", "Seguir editando",
    "¿Cómo comparo imágenes en paralelo?", "Compara de 2 a 4 imágenes, revisa sus detalles y guarda tus favoritas.", "comparar seleccionar zoom vinculado original favoritos", "En Mis imágenes, abre la gestión por lotes, selecciona de 2 a 4 imágenes y pulsa Comparar. Pueden proceder de distintos chats.\n\nLas vistas están vinculadas inicialmente: mover o ampliar una imagen actualiza la posición relativa y el zoom de las demás. Desvincúlalas para verlas por separado. Ajustar muestra la imagen completa; 1:1 carga el original a escala de píxeles. Cada panel indica su estado de carga.\n\nSelecciona una letra para ver o copiar el prompt, descargar, guardar en favoritos o editar. Los favoritos se guardan en tu cuenta. Puedes continuar la comparación en la misma pestaña; se borra al cerrar sesión. En el móvil se muestran dos paneles y las miniaturas con letras cambian el panel actual."
  ],
  "fr-FR": [
    "Comparer les images", "{count} images", "Comparer ({count})", "Sélectionnez 2 à 4 images", "Limitez la sélection à 4 images", "Reprendre la comparaison ({count})", "Retour à la sélection", "Comparez avec un zoom lié, des favoris, le téléchargement et la retouche.", "Outils de comparaison", "Lier les vues",
    "Ajuster", "Original 1:1", "Dézoomer", "Zoomer", "Zoom relatif à l’ajustement", "Échelle des pixels originaux", "Ajusté {value}×", "Original {value}%", "Original", "Aperçu",
    "Informations", "Actuelle", "Image {label}", "Ajouter l’image {label} aux favoris", "Retirer l’image {label} des favoris", "Favori", "Enregistrée", "Image indisponible", "Échec du chargement", "Original chargé",
    "Chargement de l’original", "Aperçu affiché", "Réessayer l’original", "Moins de 2 images disponibles. Revenez à la sélection.", "Certaines images sont indisponibles", "Retirer les indisponibles", "Changer le volet actuel", "Copier le prompt", "Image actuelle {label}", "Continuer la retouche",
    "Comment comparer des images côte à côte ?", "Comparez 2 à 4 images, examinez les détails et choisissez vos favorites.", "comparer sélectionner zoom lié original favoris", "Dans Mes images, ouvrez la gestion par lot, sélectionnez 2 à 4 images, puis Comparer. Les images peuvent provenir de différentes discussions.\n\nLes vues sont liées par défaut : déplacer ou agrandir une image synchronise la position relative et le zoom des autres. Déliez-les pour les examiner séparément. Ajuster affiche l’image entière ; 1:1 charge l’original à l’échelle des pixels. L’état du chargement apparaît dans chaque volet.\n\nChoisissez une lettre pour afficher ou copier le prompt, télécharger, enregistrer un favori ou retoucher. Les favoris sont conservés dans le compte. La comparaison peut reprendre dans le même onglet et s’efface à la déconnexion. Sur téléphone, deux volets sont affichés ; les miniatures avec lettres changent le volet actuel."
  ],
  "de-DE": [
    "Bilder vergleichen", "{count} Bilder", "Vergleichen ({count})", "Wähle 2–4 Bilder aus", "Reduziere die Auswahl auf höchstens 4 Bilder", "Vergleich fortsetzen ({count})", "Zur Bildauswahl", "Bilder mit gekoppeltem Zoom vergleichen, favorisieren, herunterladen und bearbeiten.", "Vergleichswerkzeuge", "Ansichten koppeln",
    "Einpassen", "Original 1:1", "Verkleinern", "Vergrößern", "Zoom relativ zur Einpassung", "Original-Pixelmaßstab", "Eingepasst {value}×", "Original {value}%", "Original", "Vorschau",
    "Informationen", "Aktuell", "Bild {label}", "Bild {label} favorisieren", "Bild {label} aus Favoriten entfernen", "Favorit", "Gespeichert", "Bild nicht verfügbar", "Bild konnte nicht geladen werden", "Original geladen",
    "Original wird geladen", "Vorschau wird angezeigt", "Original erneut laden", "Weniger als 2 Bilder verfügbar. Zurück zur Auswahl.", "Einige Bilder sind nicht verfügbar", "Nicht verfügbare entfernen", "Aktuelles Fenster wechseln", "Prompt kopieren", "Aktuelles Bild {label}", "Weiter bearbeiten",
    "Wie vergleiche ich Bilder nebeneinander?", "Vergleiche 2–4 Bilder, prüfe Details gemeinsam und speichere Favoriten.", "Vergleich Auswahl gekoppelter Zoom Original Favoriten", "Öffne in Meine Bilder die Stapelverwaltung, wähle 2–4 Bilder und dann Vergleichen. Bilder aus verschiedenen Chats sind möglich.\n\nDie Ansichten sind zunächst gekoppelt: Verschieben oder Zoomen eines Bildes überträgt relative Position und Zoom auf die anderen. Entkopple sie für einzelne Ansichten. Einpassen zeigt das ganze Bild; 1:1 lädt das Original im Pixelmaßstab. Jedes Fenster zeigt den Ladestatus.\n\nWähle einen Buchstaben, um den Prompt zu lesen oder zu kopieren, das Bild herunterzuladen, zu favorisieren oder zu bearbeiten. Favoriten bleiben im Konto gespeichert. Der Vergleich lässt sich im selben Tab fortsetzen und wird beim Abmelden gelöscht. Auf dem Telefon erscheinen zwei Fenster; Miniaturen mit Buchstaben wechseln das aktuelle Fenster."
  ],
  "pt-BR": [
    "Comparar imagens", "{count} imagens", "Comparar ({count})", "Selecione de 2 a 4 imagens", "Reduza a seleção para no máximo 4 imagens", "Continuar comparação ({count})", "Voltar à seleção", "Compare com zoom vinculado, favoritos, download e edição.", "Ferramentas de comparação", "Vincular vistas",
    "Ajustar", "Original 1:1", "Reduzir", "Ampliar", "Zoom relativo ao ajuste", "Escala dos pixels originais", "Ajuste {value}×", "Original {value}%", "Original", "Prévia",
    "Informações", "Atual", "Imagem {label}", "Favoritar imagem {label}", "Remover imagem {label} dos favoritos", "Favoritar", "Favoritada", "Imagem indisponível", "Falha ao carregar a imagem", "Original pronto",
    "Carregando original", "Exibindo prévia", "Tentar original novamente", "Menos de 2 imagens disponíveis. Volte à seleção.", "Algumas imagens estão indisponíveis", "Remover indisponíveis", "Trocar painel atual", "Copiar prompt", "Imagem atual {label}", "Continuar editando",
    "Como comparar imagens lado a lado?", "Compare de 2 a 4 imagens, examine detalhes e salve suas favoritas.", "comparar selecionar zoom vinculado original favoritos", "Em Minhas imagens, abra o gerenciamento em lote, selecione de 2 a 4 imagens e escolha Comparar. Elas podem vir de chats diferentes.\n\nAs vistas são vinculadas por padrão: arrastar ou ampliar uma imagem altera a posição relativa e o zoom das outras. Desvincule para ver separadamente. Ajustar mostra a imagem inteira; 1:1 carrega o original na escala de pixels. Cada painel informa o estado do carregamento.\n\nSelecione uma letra para ver ou copiar o prompt, baixar, favoritar ou editar. Os favoritos são salvos na conta. A comparação pode ser retomada na mesma aba e é apagada ao sair da conta. No celular, há dois painéis; miniaturas com letras trocam o painel atual."
  ],
  "ru-RU": [
    "Сравнение изображений", "Изображений: {count}", "Сравнить ({count})", "Выберите от 2 до 4 изображений", "Оставьте не более 4 изображений", "Продолжить сравнение ({count})", "К выбору изображений", "Сравнивайте с синхронным масштабом, сохраняйте, скачивайте и редактируйте.", "Инструменты сравнения", "Связать виды",
    "Вписать", "Оригинал 1:1", "Уменьшить", "Увеличить", "Масштаб относительно вписывания", "Масштаб пикселей оригинала", "Вписано {value}×", "Оригинал {value}%", "Оригинал", "Предпросмотр",
    "Сведения", "Текущее", "Изображение {label}", "В избранное: {label}", "Убрать из избранного: {label}", "В избранное", "В избранном", "Изображение недоступно", "Не удалось загрузить изображение", "Оригинал загружен",
    "Загрузка оригинала", "Показан предпросмотр", "Повторить загрузку оригинала", "Доступно менее 2 изображений. Вернитесь к выбору.", "Некоторые изображения недоступны", "Убрать недоступные", "Сменить текущее окно", "Копировать промпт", "Текущее изображение {label}", "Продолжить правку",
    "Как сравнить изображения рядом?", "Сравнивайте 2–4 изображения, проверяйте детали и выбирайте избранное.", "сравнение выбор синхронный масштаб оригинал избранное", "В разделе «Мои изображения» откройте пакетное управление, выберите 2–4 изображения и нажмите «Сравнить». Можно выбрать изображения из разных чатов.\n\nПо умолчанию виды связаны: перемещение и масштаб одного изображения меняют относительное положение и масштаб остальных. Отключите связь для отдельного просмотра. «Вписать» показывает всё изображение; 1:1 загружает оригинал в масштабе пикселей. Состояние загрузки видно в каждом окне.\n\nВыберите букву, чтобы прочитать или скопировать промпт, скачать, добавить в избранное или редактировать. Избранное сохраняется в аккаунте. Сравнение можно продолжить в той же вкладке; выход из аккаунта удаляет черновик. На телефоне видны два окна, миниатюры с буквами переключают текущее окно."
  ],
  "fa-IR": [
    "مقایسهٔ تصاویر", "{count} تصویر", "مقایسه ({count})", "۲ تا ۴ تصویر انتخاب کنید", "حداکثر ۴ تصویر را نگه دارید", "ادامهٔ مقایسه ({count})", "بازگشت به انتخاب", "تصاویر را با بزرگ‌نمایی هماهنگ مقایسه، ذخیره، دانلود و ویرایش کنید.", "ابزارهای مقایسه", "نمایش هماهنگ",
    "اندازهٔ مناسب", "اصل ۱:۱", "کوچک‌نمایی", "بزرگ‌نمایی", "بزرگ‌نمایی نسبت به اندازهٔ مناسب", "مقیاس پیکسل‌های اصلی", "متناسب {value}×", "اصل {value}%", "اصل", "پیش‌نمایش",
    "اطلاعات", "فعلی", "تصویر {label}", "افزودن تصویر {label} به علاقه‌مندی‌ها", "حذف تصویر {label} از علاقه‌مندی‌ها", "علاقه‌مندی", "ذخیره‌شده", "تصویر در دسترس نیست", "بارگیری تصویر ناموفق بود", "اصل آماده است",
    "در حال بارگیری اصل", "پیش‌نمایش نمایش داده می‌شود", "تلاش دوباره برای اصل", "کمتر از ۲ تصویر در دسترس است. به انتخاب بازگردید.", "برخی تصاویر در دسترس نیستند", "حذف موارد ناموجود", "تغییر پنجرهٔ فعلی", "کپی دستور", "تصویر فعلی {label}", "ادامهٔ ویرایش",
    "چگونه تصاویر را کنار هم مقایسه کنم؟", "۲ تا ۴ تصویر را مقایسه کنید، جزئیات را ببینید و موارد دلخواه را ذخیره کنید.", "مقایسه انتخاب بزرگ‌نمایی هماهنگ اصل علاقه‌مندی", "در تصاویر من، مدیریت گروهی را باز کنید، ۲ تا ۴ تصویر انتخاب کنید و مقایسه را بزنید. تصاویر می‌توانند از گفتگوهای متفاوت باشند.\n\nنمایش‌ها در ابتدا هماهنگ هستند: جابه‌جایی یا بزرگ‌نمایی یک تصویر، موقعیت نسبی و بزرگ‌نمایی بقیه را تغییر می‌دهد. برای بررسی جداگانه هماهنگی را خاموش کنید. اندازهٔ مناسب کل تصویر را نشان می‌دهد؛ ۱:۱ اصل را در مقیاس پیکسل بارگیری می‌کند. وضعیت بارگیری در هر پنجره دیده می‌شود.\n\nحرف تصویر را انتخاب کنید تا دستور را ببینید یا کپی کنید، دانلود کنید، به علاقه‌مندی‌ها بیفزایید یا ویرایش کنید. علاقه‌مندی‌ها در حساب ذخیره می‌شوند. مقایسه در همان برگه قابل ادامه است و با خروج از حساب پاک می‌شود. در تلفن دو پنجره نمایش داده می‌شود؛ تصاویر کوچک حرف‌دار پنجرهٔ فعلی را تغییر می‌دهند."
  ]
};

const imageCompareMessages = Object.fromEntries(Object.entries(translations).map(([locale, values]) => {
  if (values.length !== keys.length) throw new Error(`Incomplete comparison translations: ${locale}`);
  return [locale, Object.fromEntries(keys.map((key, index) => [key.startsWith("help.") ? `help.article.compareImages.${key.slice(5)}` : `compare.${key}`, values[index]]))];
})) as Record<LocaleCode, Messages>;

const libraryKeys = ["title", "selected", "hint", "view", "add", "remove", "limit", "minimum"];
const libraryText: Record<LocaleCode, string[]> = {
  "zh-CN": ["全部图片", "已选 {count}/4", "点击查看 · 勾选对比", "查看 {name}", "加入对比：{name}", "移出对比：{name}", "最多选择 4 张，请先移出一张", "至少保留一张图片"],
  "zh-TW": ["全部圖片", "已選 {count}/4", "點擊檢視 · 勾選對比", "檢視 {name}", "加入對比：{name}", "移出對比：{name}", "最多選擇 4 張，請先移出一張", "至少保留一張圖片"],
  "en-US": ["All images", "Selected {count}/4", "View · Check to compare", "View {name}", "Add to comparison: {name}", "Remove from comparison: {name}", "Select up to 4 images. Remove one first.", "Keep at least one image."],
  "ja-JP": ["すべての画像", "選択中 {count}/4", "クリックで表示・チェックで比較", "{name} を表示", "比較に追加：{name}", "比較から外す：{name}", "最大4枚です。先に1枚外してください。", "少なくとも1枚残してください。"],
  "ko-KR": ["모든 이미지", "선택 {count}/4", "클릭하여 보기 · 체크하여 비교", "{name} 보기", "비교에 추가: {name}", "비교에서 제외: {name}", "최대 4장입니다. 먼저 한 장을 제외하세요.", "이미지를 한 장 이상 유지하세요."],
  "es-ES": ["Todas las imágenes", "Selección {count}/4", "Ver · Marcar para comparar", "Ver {name}", "Añadir a comparación: {name}", "Quitar de comparación: {name}", "Máximo 4 imágenes. Quita una primero.", "Conserva al menos una imagen."],
  "fr-FR": ["Toutes les images", "Sélection {count}/4", "Voir · Cocher pour comparer", "Voir {name}", "Ajouter à la comparaison : {name}", "Retirer de la comparaison : {name}", "4 images maximum. Retirez-en une d’abord.", "Conservez au moins une image."],
  "de-DE": ["Alle Bilder", "Auswahl {count}/4", "Ansehen · Zum Vergleich markieren", "{name} ansehen", "Zum Vergleich hinzufügen: {name}", "Aus Vergleich entfernen: {name}", "Höchstens 4 Bilder. Entferne zuerst eines.", "Behalte mindestens ein Bild."],
  "pt-BR": ["Todas as imagens", "Seleção {count}/4", "Ver · Marcar para comparar", "Ver {name}", "Adicionar à comparação: {name}", "Remover da comparação: {name}", "Máximo de 4 imagens. Remova uma primeiro.", "Mantenha pelo menos uma imagem."],
  "ru-RU": ["Все изображения", "Выбрано {count}/4", "Просмотр · Отметить для сравнения", "Показать {name}", "Добавить к сравнению: {name}", "Убрать из сравнения: {name}", "Не более 4 изображений. Сначала уберите одно.", "Оставьте хотя бы одно изображение."],
  "fa-IR": ["همهٔ تصاویر", "انتخاب {count}/4", "نمایش · علامت‌زدن برای مقایسه", "نمایش {name}", "افزودن به مقایسه: {name}", "حذف از مقایسه: {name}", "حداکثر ۴ تصویر. ابتدا یکی را بردارید.", "حداقل یک تصویر را نگه دارید."]
};
for (const locale of Object.keys(libraryText) as LocaleCode[]) {
  libraryKeys.forEach((key, index) => { imageCompareMessages[locale][`compare.library.${key}`] = libraryText[locale][index]; });
}
const libraryGuide: Record<LocaleCode, string> = {
  "zh-CN": "也可以点击对话图片复制按钮后的「选图对比」进入，默认选中当前图片和已有同组结果，最多 4 张。左侧展示当前账号的全部图片，可用滚轮或拖动浏览；点击缩略图选中，再次点击取消，右下角勾选标记表示已选，可全部取消后重新选择。图库收起后，展开入口延迟隐藏，鼠标靠近左边缘时再显示。底部「纯净查看」隐藏辅助内容，按 Esc 或将鼠标移到底部显示恢复按钮。",
  "zh-TW": "也可點擊對話圖片複製按鈕後的「選圖對比」進入，預選目前圖片及同組結果，最多 4 張。左側列出目前帳號的全部圖片，可用滾輪或拖動瀏覽；點擊縮圖選取，再次點擊取消，右下角勾選標記表示已選，可全部取消後重新選擇。圖庫收起後，展開入口延遲隱藏，滑鼠靠近左邊緣時再顯示。底部「純淨檢視」隱藏輔助內容，按 Esc 或將滑鼠移到底部顯示恢復按鈕。",
  "en-US": "You can also enter from Compare after the copy button on a chat image, with the current image and available group results preselected, up to 4. Scroll or drag the left rail to browse all your images. Click a thumbnail to select it and click again to deselect; a bottom-right check marks selected images. You can deselect all and start again. The collapsed rail handle hides after a delay and reappears near the left edge. Clean view hides the controls; press Esc or move to the bottom edge to reveal the restore button.",
  "ja-JP": "チャット画像のコピーの後にある比較ボタンからも開けます。現在の画像と同じグループの結果を最大4枚選択します。左側には自分の全画像があり、スクロールやドラッグで閲覧できます。サムネイルをクリックして選択し、再度クリックして解除します。選択済みの印は右下に表示され、すべて解除して選び直すこともできます。一覧を閉じると展開ボタンは少し後に隠れ、左端にマウスを移すと再表示されます。集中表示では操作部を隠します。Escを押すか、画面下端で復元ボタンを表示して戻れます。",
  "ko-KR": "채팅 이미지의 복사 버튼 뒤에 있는 비교 버튼으로도 열 수 있으며 현재 이미지와 같은 그룹 결과를 최대 4장 미리 선택합니다. 왼쪽 목록에서 모든 이미지를 스크롤하거나 드래그하여 탐색합니다. 썸네일을 클릭하면 선택되고 다시 클릭하면 해제됩니다. 선택 표시는 오른쪽 아래에 있으며 모두 해제한 뒤 다시 선택할 수도 있습니다. 접힌 목록의 펼치기 버튼은 잠시 후 숨겨지고 왼쪽 가장자리에 마우스를 대면 나타납니다. 집중 보기에서는 도구가 숨겨집니다. Esc를 누르거나 화면 아래쪽 가장자리에서 복원 버튼을 표시하세요.",
  "es-ES": "También puedes entrar desde Comparar, después del botón de copiar de una imagen del chat, con la imagen actual y su grupo preseleccionados, hasta 4. Desplaza o arrastra la lista izquierda para ver todas tus imágenes. Pulsa una miniatura para seleccionarla y otra vez para quitarla; la marca aparece abajo a la derecha. Puedes desmarcarlas todas y volver a elegir. El botón de la lista contraída se oculta tras una pausa y reaparece junto al borde izquierdo. La vista limpia oculta los controles; pulsa Esc o lleva el cursor al borde inferior para mostrar el botón de restaurar.",
  "fr-FR": "Vous pouvez aussi ouvrir Comparer après le bouton de copie d’une image du chat, avec l’image actuelle et son groupe présélectionnés, jusqu’à 4. Faites défiler ou glisser la liste de gauche pour parcourir toutes vos images. Cliquez sur une miniature pour la sélectionner, puis à nouveau pour la retirer ; la coche apparaît en bas à droite. Vous pouvez tout désélectionner et recommencer. Le bouton de la liste repliée se masque après un délai et réapparaît au bord gauche. La vue épurée masque les commandes ; appuyez sur Échap ou placez le pointeur au bord inférieur pour afficher le bouton de restauration.",
  "de-DE": "Der Vergleich lässt sich auch hinter der Kopierschaltfläche eines Chatbildes öffnen. Das aktuelle Bild und seine Gruppe werden vorausgewählt, höchstens 4. Links kannst du alle Bilder mit dem Mausrad oder durch Ziehen durchsuchen. Ein Klick wählt ein Vorschaubild aus, ein weiterer hebt die Auswahl auf; das Häkchen steht unten rechts. Du kannst alle abwählen und neu beginnen. Der Griff der eingeklappten Liste verschwindet nach kurzer Zeit und erscheint am linken Bildschirmrand wieder. Die ungestörte Ansicht blendet die Bedienelemente aus. Mit Esc oder der Schaltfläche am unteren Rand stellst du sie wieder her.",
  "pt-BR": "Também é possível entrar por Comparar, após o botão de copiar de uma imagem no chat, com a imagem atual e seu grupo pré-selecionados, até 4. Role ou arraste a lista à esquerda para ver todas as suas imagens. Clique em uma miniatura para selecionar e novamente para remover; a marca fica no canto inferior direito. Você pode desmarcar todas e escolher de novo. O botão da lista recolhida some após um intervalo e reaparece junto à borda esquerda. A visualização limpa oculta os controles; pressione Esc ou mova o cursor até a borda inferior para mostrar o botão de restauração.",
  "ru-RU": "Сравнение также открывается кнопкой после копирования изображения в чате. Текущее изображение и результаты его группы выбираются заранее, не более 4. Слева можно просматривать все изображения прокруткой или перетаскиванием. Нажмите миниатюру для выбора и повторно для отмены; отметка находится справа внизу. Можно снять весь выбор и начать заново. Кнопка свёрнутого списка скрывается с задержкой и появляется у левого края экрана. Чистый просмотр скрывает элементы управления; нажмите Esc или подведите курсор к нижнему краю, чтобы показать кнопку восстановления.",
  "fa-IR": "از دکمهٔ مقایسه پس از کپی تصویر گفتگو نیز می‌توانید وارد شوید؛ تصویر فعلی و نتایج گروه آن تا ۴ مورد انتخاب می‌شوند. در فهرست چپ با چرخ ماوس یا کشیدن، همهٔ تصاویر را مرور کنید. برای انتخاب روی تصویر بندانگشتی بزنید و برای لغو دوباره بزنید؛ علامت انتخاب پایین سمت راست است. می‌توانید همه را لغو کرده و دوباره انتخاب کنید. دکمهٔ فهرست جمع‌شده با تأخیر پنهان می‌شود و نزدیک لبهٔ چپ دوباره ظاهر می‌شود. نمای خلوت ابزارها را پنهان می‌کند؛ Esc را بزنید یا ماوس را به لبهٔ پایین ببرید تا دکمهٔ بازگردانی نمایش داده شود."
};
for (const locale of Object.keys(libraryGuide) as LocaleCode[]) {
  imageCompareMessages[locale]["help.article.compareImages.body"] += `\n\n${libraryGuide[locale]}`;
}
const sourceKeys = ["toOriginal", "toPreview", "originalSelected", "previewSelected"];
const sourceText: Record<LocaleCode, string[]> = {
  "zh-CN": ["切换为原图", "切换为预览图", "已切换为原图", "已切换为预览图"],
  "zh-TW": ["切換為原圖", "切換為預覽圖", "已切換為原圖", "已切換為預覽圖"],
  "en-US": ["Switch to original", "Switch to preview", "Switched to original", "Switched to preview"],
  "ja-JP": ["元画像に切り替え", "プレビューに切り替え", "元画像に切り替えました", "プレビューに切り替えました"],
  "ko-KR": ["원본으로 전환", "미리보기로 전환", "원본으로 전환했습니다", "미리보기로 전환했습니다"],
  "es-ES": ["Cambiar a original", "Cambiar a vista previa", "Se cambió a la imagen original", "Se cambió a la vista previa"],
  "fr-FR": ["Passer à l’original", "Passer à l’aperçu", "Affichage de l’original", "Affichage de l’aperçu"],
  "de-DE": ["Zum Original wechseln", "Zur Vorschau wechseln", "Zum Original gewechselt", "Zur Vorschau gewechselt"],
  "pt-BR": ["Mudar para original", "Mudar para prévia", "Alterado para a imagem original", "Alterado para a prévia"],
  "ru-RU": ["Переключить на оригинал", "Переключить на предпросмотр", "Переключено на оригинал", "Переключено на предпросмотр"],
  "fa-IR": ["تغییر به تصویر اصلی", "تغییر به پیش‌نمایش", "به تصویر اصلی تغییر کرد", "به پیش‌نمایش تغییر کرد"]
};
for (const locale of Object.keys(sourceText) as LocaleCode[]) {
  sourceKeys.forEach((key, index) => { imageCompareMessages[locale][`compare.source.${key}`] = sourceText[locale][index]; });
}
const cleanViewText: Record<LocaleCode, [string, string, string]> = {
  "zh-CN": ["纯净查看（Esc 恢复）", "显示工具栏（Esc）", "从左侧选择图片开始对比，最多 4 张"],
  "zh-TW": ["純淨檢視（Esc 恢復）", "顯示工具列（Esc）", "從左側選擇圖片開始對比，最多 4 張"],
  "en-US": ["Clean view (Esc to restore)", "Show controls (Esc)", "Select up to 4 images from the left to compare"],
  "ja-JP": ["画像のみ表示（Esc で戻る）", "操作を表示（Esc）", "左側から最大4枚の画像を選んで比較します"],
  "ko-KR": ["이미지만 보기 (Esc로 복원)", "도구 표시 (Esc)", "왼쪽에서 최대 4장을 선택하여 비교하세요"],
  "es-ES": ["Vista limpia (Esc para volver)", "Mostrar controles (Esc)", "Selecciona hasta 4 imágenes de la izquierda para comparar"],
  "fr-FR": ["Vue épurée (Échap pour revenir)", "Afficher les commandes (Échap)", "Sélectionnez jusqu’à 4 images à gauche pour comparer"],
  "de-DE": ["Reine Bildansicht (Esc zum Zurückkehren)", "Bedienelemente anzeigen (Esc)", "Wähle links bis zu 4 Bilder zum Vergleichen"],
  "pt-BR": ["Visualização limpa (Esc para voltar)", "Mostrar controles (Esc)", "Selecione até 4 imagens à esquerda para comparar"],
  "ru-RU": ["Только изображения (Esc для возврата)", "Показать инструменты (Esc)", "Выберите слева до 4 изображений для сравнения"],
  "fa-IR": ["نمایش خلوت (Esc برای بازگشت)", "نمایش ابزارها (Esc)", "برای مقایسه حداکثر ۴ تصویر از سمت چپ انتخاب کنید"]
};
for (const locale of Object.keys(cleanViewText) as LocaleCode[]) {
  const [enter, exit, empty] = cleanViewText[locale];
  Object.assign(imageCompareMessages[locale], { "compare.clean.enter": enter, "compare.clean.exit": exit, "compare.library.emptySelection": empty });
}
const syncText: Record<LocaleCode, [string, string]> = {
  "zh-CN": ["开启同步查看", "关闭同步查看"],
  "zh-TW": ["開啟同步檢視", "關閉同步檢視"],
  "en-US": ["Enable synchronized viewing", "Disable synchronized viewing"],
  "ja-JP": ["同期表示を有効にする", "同期表示を無効にする"],
  "ko-KR": ["동기화 보기 켜기", "동기화 보기 끄기"],
  "es-ES": ["Activar vista sincronizada", "Desactivar vista sincronizada"],
  "fr-FR": ["Activer la vue synchronisée", "Désactiver la vue synchronisée"],
  "de-DE": ["Synchronisierte Ansicht aktivieren", "Synchronisierte Ansicht deaktivieren"],
  "pt-BR": ["Ativar visualização sincronizada", "Desativar visualização sincronizada"],
  "ru-RU": ["Включить синхронный просмотр", "Отключить синхронный просмотр"],
  "fa-IR": ["فعال کردن نمایش هماهنگ", "غیرفعال کردن نمایش هماهنگ"]
};
for (const locale of Object.keys(syncText) as LocaleCode[]) {
  const [enable, disable] = syncText[locale];
  Object.assign(imageCompareMessages[locale], { "compare.sync.enable": enable, "compare.sync.disable": disable });
}
export default imageCompareMessages;
