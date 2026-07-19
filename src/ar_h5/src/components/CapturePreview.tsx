import { Download, Share2, X } from "lucide-react";

type Props = {
  url: string;
  blob: Blob;
  onClose: () => void;
};

export function CapturePreview({ url, blob, onClose }: Props) {
  const download = () => {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ar-tryon-${Date.now()}.png`;
    anchor.click();
  };

  const share = async () => {
    const file = new File([blob], "ar-tryon.png", { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "AR 试戴" });
      return;
    }
    download();
  };

  return (
    <div className="capture-preview" role="dialog" aria-modal="true" aria-label="试戴照片">
      <img src={url} alt="AR 试戴拍摄结果" />
      <div className="capture-preview__topbar">
        <button type="button" className="icon-button" aria-label="关闭照片" title="关闭" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      <div className="capture-preview__actions">
        <button type="button" className="command-button command-button--light" onClick={download}>
          <Download size={18} />
          保存
        </button>
        <button type="button" className="command-button command-button--accent" onClick={() => void share()}>
          <Share2 size={18} />
          分享
        </button>
      </div>
    </div>
  );
}
