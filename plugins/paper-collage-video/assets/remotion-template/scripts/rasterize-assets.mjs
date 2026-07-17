import {readdir} from 'node:fs/promises';
import {extname, join} from 'node:path';
import sharp from 'sharp';

const assetDirectories = [
  {directory: 'public/textures', width: 960, height: 540, palette: true},
];

const convertDirectory = async ({directory, width, height, palette}) => {
  const files = await readdir(directory);
  const svgFiles = files.filter((file) => extname(file) === '.svg');

  await Promise.all(
    svgFiles.map(async (file) => {
      const input = join(directory, file);
      const output = join(directory, file.replace(/\.svg$/, '.png'));

      await sharp(input, {density: 96})
        .resize(width, height, {fit: 'fill'})
        .png({compressionLevel: 9, palette})
        .toFile(output);

      console.log(`${input} -> ${output}`);
    }),
  );
};

await Promise.all(assetDirectories.map(convertDirectory));
