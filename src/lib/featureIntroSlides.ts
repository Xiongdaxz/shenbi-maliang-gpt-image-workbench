import type { FeatureIntroSlide } from "../components/FeatureIntroModal";
import type { Translate } from "../i18n";
import { publicAssetPath } from "./publicAssets";

function tag(id: string, label: string) {
  return { id, label };
}

export function getAppIntroSlides(t: Translate): FeatureIntroSlide[] {
  return [
    {
      id: "chat",
      title: t("featureIntro.slides.chat.title"),
      description: [
        t("featureIntro.slides.chat.desc1"),
        t("featureIntro.slides.chat.desc2"),
        t("featureIntro.slides.chat.desc3")
      ],
      imageSrc: publicAssetPath("/image/intro-compose.svg"),
      imageAlt: t("featureIntro.slides.chat.alt"),
      tags: [
        tag("naturalLanguage", t("featureIntro.tags.naturalLanguage")),
        tag("smartAi", t("featureIntro.tags.smartAi")),
        tag("iterativeRefinement", t("featureIntro.tags.iterativeRefinement"))
      ],
      accent: "#0f766e"
    },
    {
      id: "editor",
      title: t("featureIntro.slides.editor.title"),
      description: [
        t("featureIntro.slides.editor.desc1"),
        t("featureIntro.slides.editor.desc2"),
        t("featureIntro.slides.editor.desc3")
      ],
      imageSrc: publicAssetPath("/image/intro-editor.svg"),
      imageAlt: t("featureIntro.slides.editor.alt"),
      tags: [
        tag("maskEditing", t("featureIntro.tags.maskEditing")),
        tag("inpaint", t("featureIntro.tags.inpaint")),
        tag("resize", t("featureIntro.tags.resize"))
      ],
      accent: "#0284c7"
    },
    {
      id: "cases",
      title: t("featureIntro.slides.cases.title"),
      description: [
        t("featureIntro.slides.cases.desc1"),
        t("featureIntro.slides.cases.desc2"),
        t("featureIntro.slides.cases.desc3"),
        t("featureIntro.slides.cases.desc4")
      ],
      imageSrc: publicAssetPath("/image/intro-cases.svg"),
      imageAlt: t("featureIntro.slides.cases.alt"),
      tags: [
        tag("styleCases", t("featureIntro.tags.styleCases")),
        tag("promptReuse", t("featureIntro.tags.promptReuse")),
        tag("oneClickUse", t("featureIntro.tags.oneClickUse"))
      ],
      accent: "#7c3aed"
    },
    {
      id: "assets",
      title: t("featureIntro.slides.assets.title"),
      description: [
        t("featureIntro.slides.assets.desc1"),
        t("featureIntro.slides.assets.desc2"),
        t("featureIntro.slides.assets.desc3")
      ],
      imageSrc: publicAssetPath("/image/intro-assets.svg"),
      imageAlt: t("featureIntro.slides.assets.alt"),
      tags: [
        tag("sharedAssets", t("featureIntro.tags.sharedAssets")),
        tag("multiTypeAssets", t("featureIntro.tags.multiTypeAssets")),
        tag("categoryManage", t("featureIntro.tags.categoryManage")),
        tag("readyToUse", t("featureIntro.tags.readyToUse"))
      ],
      accent: "#d97706"
    },
    {
      id: "images",
      title: t("featureIntro.slides.images.title"),
      description: [
        t("featureIntro.slides.images.desc1"),
        t("featureIntro.slides.images.desc2"),
        t("featureIntro.slides.images.desc3")
      ],
      imageSrc: publicAssetPath("/image/intro-images.svg"),
      imageAlt: t("featureIntro.slides.images.alt"),
      tags: [
        tag("myImagesView", t("featureIntro.tags.myImagesView")),
        tag("favoriteDownload", t("featureIntro.tags.favoriteDownload")),
        tag("continueEdit", t("featureIntro.tags.continueEdit"))
      ],
      accent: "#e11d48"
    },
    {
      id: "prompt-templates",
      title: t("featureIntro.slides.promptTemplates.title"),
      description: [
        t("featureIntro.slides.promptTemplates.desc1"),
        t("featureIntro.slides.promptTemplates.desc2"),
        t("featureIntro.slides.promptTemplates.desc3"),
        t("featureIntro.slides.promptTemplates.desc4")
      ],
      imageSrc: publicAssetPath("/image/intro-prompt-templates.svg"),
      imageAlt: t("featureIntro.slides.promptTemplates.alt"),
      tags: [
        tag("formCreation", t("featureIntro.tags.formCreation")),
        tag("aiAssistedStart", t("featureIntro.tags.aiAssistedStart")),
        tag("formSharing", t("featureIntro.tags.formSharing")),
        tag("historyReuse", t("featureIntro.tags.historyReuse"))
      ],
      accent: "#65a30d"
    },
    {
      id: "chat-manage",
      title: t("featureIntro.slides.chatManage.title"),
      description: [
        t("featureIntro.slides.chatManage.desc1"),
        t("featureIntro.slides.chatManage.desc2"),
        t("featureIntro.slides.chatManage.desc3")
      ],
      imageSrc: publicAssetPath("/image/intro-chat-manage.svg"),
      imageAlt: t("featureIntro.slides.chatManage.alt"),
      tags: [
        tag("dataPrivacy", t("featureIntro.tags.dataPrivacy")),
        tag("imageEncryption", t("featureIntro.tags.imageEncryption")),
        tag("archiveDelete", t("featureIntro.tags.archiveDelete")),
        tag("multiSizeDownload", t("featureIntro.tags.multiSizeDownload"))
      ],
      accent: "#6366f1"
    }
  ];
}
