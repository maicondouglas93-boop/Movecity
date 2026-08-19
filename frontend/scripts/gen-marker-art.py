"""Regenera src/shared/assets/vehicles/markerArt.js a partir dos PNGs da mesma pasta.

Rode sempre que trocar a arte de um veículo:

    python scripts/gen-marker-art.py

Trocar o PNG NÃO atualiza o marcador do mapa sozinho: a arte dele fica embutida em
base64 porque o provider do Google Maps desenha o marcador como um SVG (para levar junto
o ponteiro de direção), e um SVG consumido COMO IMAGEM não carrega recurso externo — um
caminho /assets/... ali dentro sai vazio. Os cards do painel de categorias continuam
usando o arquivo original, importado normalmente, e esses sim atualizam sozinhos.

Requer Pillow (pip install Pillow).
"""
import base64
import io
import pathlib

from PIL import Image

# O marcador é desenhado a 30px no mapa. 64 dá folga para telas densas sem inflar o
# bundle com a arte original (que pode ser 512x512).
MARKER_SIZE = (64, 64)

# (arquivo sem extensão, nome da constante exportada)
ARTES = [
    ("carro-economico", "CARRO_ECONOMICO_DATA_URI"),
    ("motoboy-moto-taxi", "MOTOBOY_MOTO_TAXI_DATA_URI"),
]

VEHICLES_DIR = pathlib.Path(__file__).resolve().parent.parent / "src" / "shared" / "assets" / "vehicles"

CABECALHO = '''// GERADO A PARTIR DOS PNGs DESTA PASTA. Não editar à mão.
//
// Por que base64 embutido e não o caminho do asset: o provider do Google Maps desenha o
// marcador como um SVG (para carregar junto o ponteiro de direção), e um SVG consumido
// COMO IMAGEM não carrega recurso externo nenhum — um <image href="/assets/..."> ali
// dentro sai vazio. Só o data URI funciona nos dois provedores.
//
// As artes são reduzidas a 64x64 aqui: o marcador é desenhado a 30px, e embutir o PNG
// original (512x512) inflaria o bundle à toa. Os cards do painel seguem usando o arquivo
// original, servido como asset normal.
//
// REGERAR sempre que trocar uma arte desta pasta — trocar o PNG NÃO atualiza este
// arquivo sozinho:
//   python scripts/gen-marker-art.py

'''


def marker_data_uri(caminho):
    imagem = Image.open(caminho).convert("RGBA")

    # Fundo opaco aqui é erro de arte, não detalhe estético: sem o círculo por trás, um
    # PNG sem transparência vira um quadrado branco invisível sobre o mapa claro — foi
    # exatamente o que aconteceu com as artes antigas (JPEG renomeado para .png).
    if imagem.getextrema()[3][0] == 255:
        raise SystemExit(
            f"{caminho.name}: imagem sem transparência. O marcador não tem fundo por trás, "
            "então ela apareceria como um bloco sólido no mapa."
        )

    if imagem.size != MARKER_SIZE:
        imagem = imagem.resize(MARKER_SIZE, Image.LANCZOS)

    buffer = io.BytesIO()
    imagem.save(buffer, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def main():
    partes = [CABECALHO]
    for arquivo, constante in ARTES:
        caminho = VEHICLES_DIR / f"{arquivo}.png"
        if not caminho.exists():
            raise SystemExit(f"não encontrei {caminho}")
        partes.append(f"export const {constante} = '{marker_data_uri(caminho)}'\n\n")
        print(f"  {arquivo}.png -> {constante}")

    destino = VEHICLES_DIR / "markerArt.js"
    destino.write_text("".join(partes), encoding="utf-8")
    print(f"{destino.name} regenerado ({destino.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
