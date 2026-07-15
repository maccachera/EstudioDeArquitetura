# Cota Zero — Estúdio de Arquitetura

Landing page one-page com **scroll-scrubbing leve**: dois timelapses
sincronizados da mesma obra (ângulos opostos) acompanham o scroll, com
crossfade entre os ângulos e split-screen no final.

**Como fica leve** (mesma técnica das páginas de produto da Apple): em vez de
fazer seek no `<video>` a cada scroll (pesado — re-decodifica desde o último
keyframe), as imagens são extraídas uma única vez no carregamento para bitmaps
em memória (80 por vídeo, 1024×576). Uma malha de previews cobre primeiro a
timeline inteira e o restante é refinado em segundo plano. Durante o scroll, o
`<canvas>` interpola as duas amostras vizinhas — resposta imediata, sem degraus
visíveis e sem decodificação. Ao final, os `<video>` são descartados.

## Como rodar

Sirva a pasta por HTTP (necessário para os range-requests de vídeo funcionarem bem):

```sh
python -m http.server 8000
# ou: npx serve .
```

Abra `http://localhost:8000`. Abrir direto via `file://` também funciona,
mas o pré-carregamento em memória (fetch → blob) é pulado nesse caso.

## Vídeos

Substitua os placeholders em `assets/`:

- `assets/video-a.mp4` — ângulo 1 (protagonista do hero e do primeiro terço)
- `assets/video-b.mp4` — ângulo 2 (~180°, assume após o crossfade)

Requisitos: mesma duração e progressão sincronizada quadro a quadro.
Como a extração de quadros acontece uma vez só no load, o encoding dos MP4
não precisa de keyframes densos — qualquer MP4 H.264 comum funciona.

## Timeline do scrubbing (frações do progresso 0–1)

| Trecho      | O que acontece                                        |
| ----------- | ----------------------------------------------------- |
| 0.00 – 0.32 | Vídeo A em tela cheia (terreno vazio → fundação)      |
| 0.32 – 0.40 | Crossfade rápido A → B (mesmo instante, outro ângulo) |
| 0.40 – 0.86 | Vídeo B em tela cheia (estrutura subindo)             |
| 0.86 – 1.00 | Split-screen: A à esquerda, B à direita               |

Os pontos são constantes no topo de `js/main.js` (`FADE_START`, `FADE_END`,
`SPLIT_START`, `SPLIT_END`), assim como `FRAME_COUNT` e a resolução dos
bitmaps (`FRAME_W`/`FRAME_H`) — ajuste livremente.

## Comportamento adaptativo

- **Mobile / touch** (`pointer: coarse`, com proteção adicional até 820 px): sem scrubbing — vídeo A
  em loop no hero, headlines viram seção estática, vídeo B não é baixado.
- **`prefers-reduced-motion`**: sem scrubbing e sem autoplay — um quadro
  parado do vídeo A e conteúdo estático.

## Estrutura

```
index.html        seções: filme (hero + scrubbing), sobre, projetos, processo, contato
css/styles.css    paleta derivada dos vídeos + tipografia + layout
js/main.js        lógica de scrubbing comentada (progresso, seek, crossfade, split)
assets/           vídeos do scrubbing + fotos dos projetos em assets/projects/
```
