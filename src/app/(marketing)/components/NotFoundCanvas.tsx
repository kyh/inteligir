import { useEffect } from "react";

export const NotFoundCanvas = () => {
  useEffect(() => {
    const HEIGHT = window.innerHeight / 1;
    const WIDTH = window.innerWidth / 1;
    const TOTAL = HEIGHT * WIDTH;

    const CANVAS = document.createElement("canvas");

    CANVAS.height = HEIGHT;
    CANVAS.width = WIDTH;
    const CONTEXT = CANVAS.getContext("2d") as CanvasRenderingContext2D;

    /**
     * Start rendering some stuff.
     */
    for (let pixel = 0; pixel < TOTAL; pixel++) {
      const X = pixel % WIDTH;
      const Y = Math.floor(pixel / WIDTH);
      const generateColor = () => {
        const base = Math.floor(Math.random() * 255).toString(16);
        return `#${base}${base}${base}`;
      };
      const color = generateColor();
      CONTEXT.fillStyle = color;
      CONTEXT.fillRect(X, Y, 1, 1);
    }

    document.body.style.background = `url(${CANVAS.toDataURL()})`;

    const update = () => {
      const X = Math.floor(Math.random() * WIDTH);
      const Y = Math.floor(Math.random() * HEIGHT);
      document.body.style.backgroundPosition = `${X}px ${Y}px`;
      animationFrame = window.requestAnimationFrame(update);
    };

    let animationFrame = window.requestAnimationFrame(update);

    return () => {
      document.body.style.background = "";
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return null;
};
