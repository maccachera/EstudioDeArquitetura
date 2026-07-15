# Cota Zero — Estúdio de Arquitetura

Landing page one-page para um estúdio de arquitetura. A capa usa o primeiro
vídeo em tela cheia, com reprodução automática silenciosa e loop contínuo.

## Como rodar

Abra `index.html` diretamente ou sirva a pasta por HTTP:

```sh
python -m http.server 8000
```

Depois, acesse `http://localhost:8000`.

## Conteúdo

- `assets/video-a.mp4` — vídeo utilizado na capa.
- `assets/projects/` — imagens dos projetos selecionados.
- `index.html` — estrutura completa da página.
- `css/styles.css` — identidade visual e layout responsivo.

O vídeo da capa utiliza `autoplay muted loop playsinline`, sem JavaScript e
sem qualquer sincronização com o scroll.
