import type { LocaleCode } from "../locales";
import type { Messages } from "./types";

const keys = [
  "resize.left","resize.right","resize.candidates","resizeHeight","canvasShare","resizeHint",
  "demoMode","projectSettings","flow.brief","flow.style","flow.delivery",
  "guidance.archived","guidance.generating","guidance.generatingStyle","guidance.brief","guidance.unsaved","guidance.pickStyle","guidance.generateRest","guidance.review","guidance.ready","guidance.done",
  "demoModeHint","realCreation","imageList","addImage","imageReady","styleImage",
  "demoStyles","candidatePlans","finalImage","viewing","planNumber","demoStyle.airy","demoStyle.dark","demoStyle.editorial",
  "candidateEmpty","currentImage","imagePosition","pickImage","imageRequirements","saveRequirements","requirementsHint","notSelected","selectedForFinal","useAsStyle","selectThis","styleSelectionHint","selectionHint","identicalCandidate",
  "switchDemoStyle","generatePlan","editThisImage","comparePlans","demoStylesHint","projectSettingsHint","demoTroubleshooting","previewExistingStyle","prepareStyle","changeStyleWarning",
  "action.confirm","action.anchor","action.review","action.finalize"
] as const;
const labels: Record<LocaleCode, string[]> = {
  "zh-CN": [
    "调整图片列表宽度","调整操作区宽度","调整候选区高度","候选区 {value}px","画布 {value}%","拖动调整 · 双击恢复",
    "流程演示","套图设置","填写需求","确定风格","选图与下载",
    "项目已归档，恢复后可继续操作。","正在生成图片，原成稿会保留。","正在生成风格候选，完成后选一张。","填写需求并检查每张图片的要求，然后确认生成。","先保存当前修改，再继续生成或下载。","从下方候选中选一张作为风格样图。","风格已确定，可以生成其余图片。","还有 {count} 张待选，逐张选好后即可完成。","{count} 张已选好，可继续换图或完成下载。","整套已完成，可以随时下载。",
    "当前使用内置模板演示，不调用 AI 生图。","用于真实创作","本套图片","添加图片","已选好","风格样图",
    "演示样式","候选方案","当前成稿","正在查看","方案 {number}","留白版","深色版","图文版",
    "候选完成后会显示在这里，查看后再选为成稿。","当前图片","第 {index} 张 / 共 {total} 张","选图","本图要求","保存要求","保存要求后，再生成新方案；现有图片不会自动改变。","待选用","已选为成稿","用作风格样图","选用这张图","其余图片会参考这张的视觉风格。","选用后只替换本张，其余图片不变。","这张与当前成稿的文件内容相同，可继续使用原成稿。",
    "切换演示样式","生成新方案","修改图片","比较方案","演示提供固定的排版与配色，不生成新的场景。","这里的要求作用于整套图片，修改后可能需要重新确认风格。","演示排错体验","查看已有样式","准备此样式","更换风格样图后，其余图片需要重新复核。已有图片会保留，确定更换吗？",
    "确认内容，生成风格候选","去选风格样图","去选未完成图片","完成并下载"
  ],
  "zh-TW": [
    "調整圖片清單寬度","調整操作區寬度","調整候選區高度","候選區 {value}px","畫布 {value}%","拖曳調整 · 按兩下還原",
    "流程示範","套圖設定","填寫需求","確定風格","選圖與下載",
    "專案已封存，還原後可繼續操作。","正在產生圖片，原成稿會保留。","正在產生風格候選，完成後選一張。","填寫需求並檢查每張圖片的要求，然後確認產生。","先儲存修改，再繼續產生或下載。","從下方候選中選一張作為風格樣圖。","風格已確定，可以產生其餘圖片。","還有 {count} 張待選，逐張選好後即可完成。","{count} 張已選好，可繼續換圖或完成下載。","整套已完成，可以隨時下載。",
    "目前使用內建範本示範，不呼叫 AI 生圖。","用於正式創作","本套圖片","新增圖片","已選好","風格樣圖",
    "示範樣式","候選方案","目前成稿","正在檢視","方案 {number}","留白版","深色版","圖文版",
    "候選完成後會顯示在這裡，檢視後再選為成稿。","目前圖片","第 {index} 張 / 共 {total} 張","選圖","本圖要求","儲存要求","儲存要求後再產生新方案；現有圖片不會自動改變。","待選用","已選為成稿","用作風格樣圖","選用這張圖","其餘圖片會參考這張的視覺風格。","選用後只替換本張，其餘圖片不變。","這張與目前成稿的檔案內容相同，可繼續使用原成稿。",
    "切換示範樣式","產生新方案","修改圖片","比較方案","示範提供固定的排版與配色，不產生新場景。","這裡的要求作用於整套圖片，修改後可能需要重新確認風格。","示範排錯體驗","檢視已有樣式","準備此樣式","更換風格樣圖後，其餘圖片需要重新複核。已有圖片會保留，確定更換嗎？",
    "確認內容，產生風格候選","去選風格樣圖","去選未完成圖片","完成並下載"
  ],
  "en-US": [
    "Resize image list","Resize action panel","Resize candidate strip","Candidates {value}px","Canvas {value}%","Drag to resize · Double-click to reset",
    "Workflow demo","Set settings","Describe the brief","Choose a style","Select & download",
    "This project is archived. Restore it to continue.","Generating images; existing selections are kept.","Generating style options. Choose one when ready.","Describe the brief, review each image, then confirm generation.","Save your changes before generating or downloading.","Choose a candidate below as the style reference.","The style is selected. Generate the remaining images.","{count} images still need a selection.","{count} images are selected. Keep refining or finish and download.","The set is complete and ready to download.",
    "This demo uses built-in templates without AI generation.","Use for real creation","Images in this set","Add image","Selected","Style reference",
    "Demo styles","Candidates","Current final","Viewing","Option {number}","Airy","Dark","Editorial",
    "Candidates appear here when ready. Preview one, then select it.","Current image","Image {index} of {total}","Select","Image requirements","Save requirements","Save requirements, then generate a new option. Existing images stay unchanged.","Not selected","Selected as final","Use as style reference","Select this image","The other images will follow this visual style.","Only this image is replaced; other images stay unchanged.","This file is identical to the current final. You can keep the original selection.",
    "Switch demo style","Generate new option","Edit image","Compare options","Demo styles use fixed layouts and colors, without creating new scenes.","These requirements affect the whole set. Changes may require choosing the style again.","Demo troubleshooting","View existing style","Prepare this style","Changing the style reference requires reviewing the other images again. Existing images are kept. Continue?",
    "Confirm & generate style options","Choose style reference","Review remaining images","Finish & download"
  ],
  "ja-JP": [
    "画像一覧の幅を調整","操作欄の幅を調整","候補欄の高さを調整","候補欄 {value}px","キャンバス {value}%","ドラッグで調整・ダブルクリックで元に戻す",
    "操作デモ","セット設定","要件を記入","スタイルを決定","選択とダウンロード",
    "アーカイブ済みです。復元して続行してください。","画像を生成中です。選択済みの画像は保持されます。","スタイル候補を生成中です。完了後に選んでください。","要件と各画像の内容を確認して生成を開始します。","変更を保存してから生成またはダウンロードしてください。","下の候補からスタイルの基準画像を選びます。","スタイルが決まりました。残りの画像を生成できます。","あと {count} 枚の選択が必要です。","{count} 枚を選択済みです。調整を続けるかダウンロードできます。","セットが完成しました。ダウンロードできます。",
    "内蔵テンプレートによるデモです。AI生成は行いません。","実際の制作に使用","セット内の画像","画像を追加","選択済み","スタイル基準",
    "デモスタイル","候補","現在の完成画像","表示中","候補 {number}","余白","ダーク","エディトリアル",
    "生成完了後に候補が表示されます。確認してから選択してください。","現在の画像","{total} 枚中 {index} 枚目","選択","画像の要件","要件を保存","要件を保存してから新しい候補を生成します。既存画像は自動変更されません。","未選択","完成画像に選択済み","スタイル基準に使用","この画像を選択","他の画像はこのスタイルを参考にします。","この画像だけを置き換えます。他の画像は変わりません。","現在の完成画像と同一のファイルです。元の選択を維持できます。",
    "デモスタイルを切替","新しい候補を生成","画像を編集","候補を比較","固定のレイアウトと配色のデモです。新しい場面は生成しません。","セット全体に適用されます。変更後はスタイルの再確認が必要な場合があります。","デモのエラー体験","既存スタイルを表示","このスタイルを準備","基準画像を変更すると他の画像の再確認が必要です。既存画像は保持されます。続行しますか？",
    "確認してスタイル候補を生成","スタイル基準を選択","未選択の画像を確認","完成してダウンロード"
  ],
  "ko-KR": [
    "이미지 목록 너비 조절","작업 패널 너비 조절","후보 영역 높이 조절","후보 영역 {value}px","캔버스 {value}%","드래그하여 조절 · 두 번 클릭하여 복원",
    "과정 데모","세트 설정","요구사항 작성","스타일 선택","선택 및 다운로드",
    "보관된 프로젝트입니다. 복원 후 계속하세요.","이미지를 생성 중입니다. 기존 선택은 유지됩니다.","스타일 후보를 생성 중입니다. 완료되면 하나를 선택하세요.","요구사항과 각 이미지 내용을 확인하고 생성을 시작하세요.","변경 사항을 저장한 뒤 생성하거나 다운로드하세요.","아래 후보에서 스타일 기준 이미지를 선택하세요.","스타일이 정해졌습니다. 나머지 이미지를 생성하세요.","아직 {count}개 이미지의 선택이 필요합니다.","{count}개 이미지가 선택되었습니다. 수정하거나 완료 후 다운로드하세요.","세트가 완성되어 다운로드할 수 있습니다.",
    "내장 템플릿 데모이며 AI 생성은 호출하지 않습니다.","실제 제작에 사용","세트 이미지","이미지 추가","선택됨","스타일 기준",
    "데모 스타일","후보","현재 완성본","보는 중","후보 {number}","여백형","어두운형","편집형",
    "후보가 완성되면 여기에 표시됩니다. 확인한 뒤 선택하세요.","현재 이미지","총 {total}개 중 {index}번째","선택","이미지 요구사항","요구사항 저장","요구사항을 저장하고 새 후보를 생성하세요. 기존 이미지는 자동 변경되지 않습니다.","선택 전","완성본으로 선택됨","스타일 기준으로 사용","이 이미지 선택","다른 이미지가 이 시각적 스타일을 참고합니다.","이 이미지만 교체하며 다른 이미지는 유지됩니다.","현재 완성본과 같은 파일입니다. 기존 선택을 유지할 수 있습니다.",
    "데모 스타일 전환","새 후보 생성","이미지 수정","후보 비교","고정된 배치와 색상의 데모이며 새로운 장면은 생성하지 않습니다.","세트 전체에 적용됩니다. 변경 후 스타일을 다시 확인해야 할 수 있습니다.","데모 오류 체험","기존 스타일 보기","이 스타일 준비","스타일 기준을 변경하면 다른 이미지를 다시 검토해야 합니다. 기존 이미지는 유지됩니다. 계속할까요?",
    "확인하고 스타일 후보 생성","스타일 기준 선택","미완료 이미지 검토","완료 및 다운로드"
  ],
  "es-ES": [
    "Ajustar lista de imágenes","Ajustar panel de acciones","Ajustar altura de candidatos","Candidatos {value}px","Lienzo {value}%","Arrastra para ajustar · Doble clic para restablecer",
    "Demostración","Ajustes del conjunto","Escribir requisitos","Elegir estilo","Elegir y descargar",
    "Proyecto archivado. Restáuralo para continuar.","Generando imágenes; se conservan las elegidas.","Generando opciones de estilo. Elige una al terminar.","Describe y revisa cada imagen antes de confirmar.","Guarda los cambios antes de generar o descargar.","Elige un candidato como referencia de estilo.","Estilo elegido. Genera las imágenes restantes.","Falta elegir {count} imágenes.","{count} imágenes elegidas. Puedes ajustar o finalizar y descargar.","El conjunto está listo para descargar.",
    "Esta demo usa plantillas integradas, sin generación por IA.","Usar para crear","Imágenes del conjunto","Añadir imagen","Elegida","Referencia de estilo",
    "Estilos de demo","Candidatos","Imagen final actual","Viendo","Opción {number}","Con espacio","Oscuro","Editorial",
    "Los candidatos aparecerán aquí. Revísalos antes de elegir.","Imagen actual","Imagen {index} de {total}","Elegir","Requisitos de la imagen","Guardar requisitos","Guarda los requisitos y genera otra opción. Las imágenes existentes no cambian automáticamente.","Sin elegir","Elegida como final","Usar como referencia","Elegir esta imagen","Las demás imágenes seguirán este estilo visual.","Solo se sustituye esta imagen; las demás se mantienen.","Este archivo es idéntico al final actual. Puedes mantener la selección original.",
    "Cambiar estilo de demo","Generar otra opción","Editar imagen","Comparar opciones","La demo usa diseños y colores fijos, sin crear nuevas escenas.","Estos requisitos afectan a todo el conjunto. Puede ser necesario elegir de nuevo el estilo.","Prueba de errores","Ver estilo existente","Preparar este estilo","Cambiar la referencia requiere revisar las demás imágenes. Se conservarán las existentes. ¿Continuar?",
    "Confirmar y generar estilos","Elegir referencia","Revisar imágenes pendientes","Finalizar y descargar"
  ],
  "fr-FR": [
    "Redimensionner la liste","Redimensionner les actions","Redimensionner les propositions","Propositions {value}px","Zone image {value}%","Glisser pour ajuster · Double-clic pour rétablir",
    "Démonstration","Réglages de l’ensemble","Décrire le besoin","Choisir le style","Choisir et télécharger",
    "Projet archivé. Restaurez-le pour continuer.","Génération en cours ; les choix existants sont conservés.","Génération des styles. Choisissez-en un une fois terminé.","Décrivez le besoin et vérifiez chaque image avant de confirmer.","Enregistrez les changements avant de générer ou télécharger.","Choisissez une proposition comme référence de style.","Le style est choisi. Générez les images restantes.","Il reste {count} images à choisir.","{count} images choisies. Affinez ou terminez et téléchargez.","L’ensemble est terminé et prêt à télécharger.",
    "Cette démo utilise des modèles intégrés sans génération IA.","Créer pour de vrai","Images de l’ensemble","Ajouter une image","Choisie","Référence de style",
    "Styles de démo","Propositions","Image finale actuelle","Affichage","Option {number}","Aéré","Sombre","Éditorial",
    "Les propositions apparaîtront ici. Vérifiez-les avant de choisir.","Image actuelle","Image {index} sur {total}","Choisir","Exigences de l’image","Enregistrer les exigences","Enregistrez puis générez une nouvelle proposition. Les images existantes ne changent pas automatiquement.","Non choisie","Choisie comme finale","Utiliser comme référence","Choisir cette image","Les autres images suivront ce style visuel.","Seule cette image est remplacée ; les autres sont conservées.","Ce fichier est identique à l’image finale actuelle. Vous pouvez garder le choix initial.",
    "Changer de style de démo","Générer une proposition","Modifier l’image","Comparer","La démo utilise des mises en page et couleurs fixes, sans nouvelles scènes.","Ces exigences concernent tout l’ensemble. Le style peut nécessiter une nouvelle validation.","Essai des erreurs","Voir le style existant","Préparer ce style","Changer de référence nécessite de revoir les autres images. Elles seront conservées. Continuer ?",
    "Confirmer et générer les styles","Choisir la référence","Vérifier les images restantes","Terminer et télécharger"
  ],
  "de-DE": [
    "Bildliste skalieren","Aktionsbereich skalieren","Höhe der Varianten ändern","Varianten {value}px","Bildfläche {value}%","Ziehen zum Anpassen · Doppelklick zum Zurücksetzen",
    "Ablaufdemo","Set-Einstellungen","Anforderungen","Stil wählen","Auswählen und laden",
    "Projekt archiviert. Zum Fortfahren wiederherstellen.","Bilder werden erstellt. Bisherige Auswahlen bleiben erhalten.","Stilvarianten werden erstellt. Danach eine auswählen.","Anforderungen und Bilder prüfen und die Erstellung bestätigen.","Änderungen vor dem Erstellen oder Herunterladen speichern.","Eine Variante unten als Stilreferenz wählen.","Der Stil steht fest. Die übrigen Bilder können erstellt werden.","Für {count} Bilder fehlt noch eine Auswahl.","{count} Bilder ausgewählt. Weiter verfeinern oder abschließen und herunterladen.","Das Set ist fertig und kann heruntergeladen werden.",
    "Diese Demo nutzt integrierte Vorlagen ohne KI-Generierung.","Für echte Erstellung","Bilder im Set","Bild hinzufügen","Ausgewählt","Stilreferenz",
    "Demo-Stile","Varianten","Aktuelles Endbild","Vorschau","Variante {number}","Luftig","Dunkel","Editorial",
    "Fertige Varianten erscheinen hier. Erst ansehen, dann auswählen.","Aktuelles Bild","Bild {index} von {total}","Auswählen","Bildanforderungen","Anforderungen speichern","Anforderungen speichern und eine neue Variante erstellen. Vorhandene Bilder ändern sich nicht automatisch.","Nicht ausgewählt","Als Endbild ausgewählt","Als Stilreferenz nutzen","Dieses Bild auswählen","Die anderen Bilder orientieren sich an diesem Stil.","Nur dieses Bild wird ersetzt. Andere Bilder bleiben erhalten.","Diese Datei ist mit dem aktuellen Endbild identisch. Die bisherige Auswahl kann bleiben.",
    "Demo-Stil wechseln","Neue Variante erstellen","Bild bearbeiten","Varianten vergleichen","Die Demo nutzt feste Layouts und Farben ohne neue Szenen.","Diese Anforderungen gelten für das gesamte Set. Änderungen können eine neue Stilwahl erfordern.","Demo-Fehler testen","Vorhandenen Stil ansehen","Stil vorbereiten","Eine neue Stilreferenz erfordert die erneute Prüfung der anderen Bilder. Vorhandene Bilder bleiben erhalten. Fortfahren?",
    "Bestätigen und Stile erstellen","Stilreferenz wählen","Offene Bilder prüfen","Abschließen und laden"
  ],
  "pt-BR": [
    "Ajustar lista de imagens","Ajustar painel de ações","Ajustar altura das opções","Opções {value}px","Tela {value}%","Arraste para ajustar · Clique duplo para restaurar",
    "Demonstração","Configurações do conjunto","Descrever requisitos","Escolher estilo","Selecionar e baixar",
    "Projeto arquivado. Restaure para continuar.","Gerando imagens; as seleções atuais serão mantidas.","Gerando opções de estilo. Escolha uma quando terminar.","Descreva e confira cada imagem antes de confirmar.","Salve as alterações antes de gerar ou baixar.","Escolha uma opção abaixo como referência de estilo.","O estilo foi escolhido. Gere as imagens restantes.","Ainda falta selecionar {count} imagens.","{count} imagens selecionadas. Ajuste mais ou finalize e baixe.","O conjunto está concluído e pronto para baixar.",
    "Esta demo usa modelos integrados sem geração por IA.","Usar na criação real","Imagens do conjunto","Adicionar imagem","Selecionada","Referência de estilo",
    "Estilos de demo","Opções","Imagem final atual","Visualizando","Opção {number}","Com respiro","Escuro","Editorial",
    "As opções prontas aparecerão aqui. Confira antes de selecionar.","Imagem atual","Imagem {index} de {total}","Selecionar","Requisitos da imagem","Salvar requisitos","Salve os requisitos e gere uma nova opção. As imagens existentes não mudam automaticamente.","Não selecionada","Selecionada como final","Usar como referência","Selecionar esta imagem","As demais imagens seguirão este estilo visual.","Apenas esta imagem será substituída; as outras serão mantidas.","Este arquivo é idêntico ao final atual. Você pode manter a seleção original.",
    "Trocar estilo de demo","Gerar nova opção","Editar imagem","Comparar opções","A demo usa layouts e cores fixos sem criar novas cenas.","Estes requisitos afetam todo o conjunto. As alterações podem exigir nova escolha de estilo.","Testar erros da demo","Ver estilo existente","Preparar este estilo","Mudar a referência exige revisar as outras imagens. As existentes serão mantidas. Continuar?",
    "Confirmar e gerar estilos","Escolher referência","Revisar imagens restantes","Finalizar e baixar"
  ],
  "ru-RU": [
    "Изменить ширину списка","Изменить ширину действий","Изменить высоту вариантов","Варианты {value}px","Полотно {value}%","Перетащите для изменения · Двойной щелчок для сброса",
    "Демонстрация","Настройки набора","Описать задачу","Выбрать стиль","Выбрать и скачать",
    "Проект в архиве. Восстановите его для продолжения.","Идёт генерация. Текущий выбор сохранится.","Создаются варианты стиля. После завершения выберите один.","Опишите задачу и проверьте каждое изображение перед подтверждением.","Сохраните изменения перед генерацией или скачиванием.","Выберите вариант ниже как образец стиля.","Стиль выбран. Можно создать остальные изображения.","Осталось выбрать {count} изображений.","Выбрано {count} изображений. Продолжите правки или завершите и скачайте.","Набор готов к скачиванию.",
    "Демонстрация использует встроенные шаблоны без генерации ИИ.","Начать реальное создание","Изображения набора","Добавить изображение","Выбрано","Образец стиля",
    "Демостили","Варианты","Текущий итог","Просмотр","Вариант {number}","Светлый","Тёмный","Редакционный",
    "Готовые варианты появятся здесь. Просмотрите их перед выбором.","Текущее изображение","Изображение {index} из {total}","Выбор","Требования к изображению","Сохранить требования","Сохраните требования, затем создайте новый вариант. Существующие изображения не изменятся автоматически.","Не выбрано","Выбрано итоговым","Использовать как образец","Выбрать изображение","Остальные изображения будут следовать этому стилю.","Заменяется только это изображение. Остальные сохраняются.","Файл идентичен текущему итоговому изображению. Можно сохранить прежний выбор.",
    "Сменить демостиль","Создать новый вариант","Изменить изображение","Сравнить варианты","Демо использует фиксированные макеты и цвета, без новых сцен.","Требования действуют на весь набор. После изменений может потребоваться новый выбор стиля.","Проверка ошибок демо","Открыть готовый стиль","Подготовить стиль","После смены образца потребуется проверить остальные изображения. Они сохранятся. Продолжить?",
    "Подтвердить и создать стили","Выбрать образец стиля","Проверить остальные","Завершить и скачать"
  ],
  "fa-IR": [
    "تغییر عرض فهرست تصاویر","تغییر عرض پنل عملیات","تغییر ارتفاع گزینه‌ها","گزینه‌ها {value}px","بوم {value}%","برای تنظیم بکشید · دوبار کلیک برای بازنشانی",
    "نمایش روند","تنظیمات مجموعه","نوشتن نیازها","انتخاب سبک","انتخاب و دریافت",
    "پروژه بایگانی شده است. برای ادامه بازیابی کنید.","در حال ساخت تصاویر؛ انتخاب‌های قبلی حفظ می‌شوند.","گزینه‌های سبک در حال ساخت است؛ سپس یکی را انتخاب کنید.","نیازها و هر تصویر را بررسی و ساخت را تأیید کنید.","پیش از ساخت یا دریافت، تغییرات را ذخیره کنید.","یکی از گزینه‌های پایین را به عنوان مرجع سبک انتخاب کنید.","سبک انتخاب شده است. تصاویر باقی‌مانده را بسازید.","هنوز {count} تصویر نیاز به انتخاب دارد.","{count} تصویر انتخاب شده است. اصلاح کنید یا پایان دهید و دریافت کنید.","مجموعه کامل و آماده دریافت است.",
    "این نمایش از قالب‌های داخلی استفاده می‌کند و تصویر هوش مصنوعی تولید نمی‌کند.","استفاده برای ساخت واقعی","تصاویر مجموعه","افزودن تصویر","انتخاب‌شده","مرجع سبک",
    "سبک‌های نمایشی","گزینه‌ها","نسخه نهایی فعلی","در حال مشاهده","گزینه {number}","خلوت","تیره","مجله‌ای",
    "گزینه‌های آماده اینجا نمایش داده می‌شوند. ابتدا بررسی و سپس انتخاب کنید.","تصویر فعلی","تصویر {index} از {total}","انتخاب","نیازهای تصویر","ذخیره نیازها","نیازها را ذخیره و گزینه تازه بسازید. تصاویر موجود خودکار تغییر نمی‌کنند.","انتخاب نشده","نسخه نهایی انتخاب‌شده","استفاده به عنوان مرجع","انتخاب این تصویر","تصاویر دیگر از این سبک بصری پیروی می‌کنند.","فقط این تصویر جایگزین می‌شود و بقیه حفظ می‌شوند.","این فایل با نسخه نهایی فعلی یکسان است. می‌توانید انتخاب قبلی را حفظ کنید.",
    "تغییر سبک نمایشی","ساخت گزینه تازه","ویرایش تصویر","مقایسه گزینه‌ها","نمایش از چیدمان و رنگ ثابت استفاده می‌کند و صحنه تازه نمی‌سازد.","این نیازها بر کل مجموعه اثر دارند. تغییر ممکن است نیازمند انتخاب دوباره سبک باشد.","آزمایش خطای نمایش","دیدن سبک موجود","آماده‌سازی این سبک","تغییر مرجع سبک نیازمند بازبینی سایر تصاویر است. تصاویر موجود حفظ می‌شوند. ادامه می‌دهید؟",
    "تأیید و ساخت گزینه‌های سبک","انتخاب مرجع سبک","بازبینی تصاویر باقی‌مانده","پایان و دریافت"
  ]
};
const result = {} as Record<LocaleCode, Messages>;
for (const locale of Object.keys(labels) as LocaleCode[]) result[locale] = Object.fromEntries(keys.map((key,index)=>[`sets.${key}`,labels[locale][index]]));
export default result;
