import asyncio, sys, json
sys.path.insert(0, __file__.rsplit('/',1)[0])
from generate_image import generate_image
async def main():
    args = json.loads(sys.argv[1])
    data = await generate_image(args['prompt'], aspect_ratio=args.get('aspect','1:1'), model=args.get('model','gpt_image_2_6_flare'))
    open(args['out'],'wb').write(data)
    print('ok')
asyncio.run(main())
