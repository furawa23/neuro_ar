using System;
using System.Diagnostics;
using System.IO;
using NeuroAR.Vision;

internal static class Program
{
    private static int checks;
    private static readonly MarkerDetector detector = new MarkerDetector();
    private static readonly ImagePoint[] square = { new ImagePoint(130, 100), new ImagePoint(350, 100), new ImagePoint(350, 320), new ImagePoint(130, 320) };

    private static void Main(string[] args)
    {
        for (int rotation = 0; rotation < 4; rotation++)
        {
            CheckTarget(square, rotation, 0, false);
            CheckTarget(new[] { new ImagePoint(155, 65), new ImagePoint(393, 142), new ImagePoint(333, 363), new ImagePoint(87, 277) }, rotation, 12, true);
            CheckTarget(new[] { new ImagePoint(220, 70), new ImagePoint(325, 110), new ImagePoint(355, 350), new ImagePoint(175, 325) }, rotation, 8, true);
        }
        CheckTarget(square, 0, 9, true, 1);
        MarkerObservation observation;
        Assert(!detector.TryDetect(Render(square, 0, 0, false, 2), 480, 400, out observation), "Two corrupted payload bits must not decode.");
        Assert(!detector.TryDetect(Render(square, 0, 0, false, 0, true), 480, 400, out observation), "Mirrored pattern must not decode.");
        Assert(!detector.TryDetect(new byte[480 * 400], 480, 400, out observation), "A flat dark frame is not a marker.");
        var white = new byte[480 * 400];
        Array.Fill(white, (byte)240);
        Assert(!detector.TryDetect(white, 480, 400, out observation), "A flat light frame is not a marker.");
        var tiny = new[] { new ImagePoint(100, 100), new ImagePoint(121, 100), new ImagePoint(121, 121), new ImagePoint(100, 121) };
        Assert(!detector.TryDetect(Render(tiny, 0, 0, false), 480, 400, out observation), "Tiny marker is rejected rather than guessing.");
        var truncated = new[] { new ImagePoint(-10, 100), new ImagePoint(150, 100), new ImagePoint(150, 260), new ImagePoint(-10, 260) };
        Assert(!detector.TryDetect(Render(truncated, 0, 0, false), 480, 400, out observation), "A truncated target is rejected.");
        Throws<ArgumentNullException>(() => detector.TryDetect(null, 10, 10, out observation));
        Throws<ArgumentException>(() => detector.TryDetect(new byte[2], 10, 10, out observation));
        Throws<ArgumentOutOfRangeException>(() => detector.TryDetect(new byte[2], 0, 10, out observation));
        Throws<ArgumentOutOfRangeException>(() => MarkerDefinition.IsWhite(-1, 0));
        if (args.Length > 0) CheckPrintedAsset(args[0]);
        var frame = Render(square, 0, 8, true);
        var timer = Stopwatch.StartNew();
        for (int i = 0; i < 50; i++) Assert(detector.TryDetect(frame, 480, 400, out observation), "Repeated-frame detector remains stable.");
        timer.Stop();
        Console.WriteLine("Detector: " + checks + " assertions passed. Synthetic 480x400 frames: " + (timer.Elapsed.TotalMilliseconds / 50).ToString("0.00") + " ms/frame on this PC.");
    }

    private static void CheckPrintedAsset(string path)
    {
        byte[] file = File.ReadAllBytes(path);
        int offset = 0;
        if (Token(file, ref offset) != "P5") throw new InvalidDataException("Expected a binary P5 PGM print fixture.");
        int width = int.Parse(Token(file, ref offset));
        int height = int.Parse(Token(file, ref offset));
        if (Token(file, ref offset) != "255") throw new InvalidDataException("Expected an 8-bit grayscale PGM.");
        if (offset >= file.Length || !char.IsWhiteSpace((char)file[offset])) throw new InvalidDataException("Missing PGM separator.");
        if (file[offset++] == 13 && offset < file.Length && file[offset] == 10) offset++;
        if (file.Length - offset < width * height) throw new InvalidDataException("Truncated PGM pixels.");
        double scale = Math.Min(1.0, 512.0 / Math.Max(width, height));
        int scaledWidth = (int)Math.Round(width * scale), scaledHeight = (int)Math.Round(height * scale);
        byte[] image = new byte[scaledWidth * scaledHeight];
        for (int y = 0; y < scaledHeight; y++)
            for (int x = 0; x < scaledWidth; x++)
                image[y * scaledWidth + x] = file[offset + Math.Min(height - 1, (int)(y / scale)) * width + Math.Min(width - 1, (int)(x / scale))];
        MarkerObservation found;
        Assert(detector.TryDetect(image, scaledWidth, scaledHeight, out found), "The actual generated printable asset must decode.");
        Assert(found.BitErrors == 0, "The printed pattern matches the detector code exactly.");
        double[,] expected = { { 1.0 / 9, 1.0 / 9 }, { 8.0 / 9, 1.0 / 9 }, { 8.0 / 9, 8.0 / 9 }, { 1.0 / 9, 8.0 / 9 } };
        for (int i = 0; i < 4; i++)
        {
            double dx = found.Corners[i].X - expected[i, 0] * scaledWidth;
            double dy = found.Corners[i].Y - expected[i, 1] * scaledHeight;
            Assert(Math.Sqrt(dx * dx + dy * dy) < 3.2, "Printed-asset corner order matches canonical image orientation.");
        }
        Console.WriteLine("Generated print fixture verified: " + path);
    }

    private static string Token(byte[] source, ref int offset)
    {
        while (offset < source.Length)
        {
            if (char.IsWhiteSpace((char)source[offset])) { offset++; continue; }
            if (source[offset] == '#')
            {
                while (offset < source.Length && source[offset] != 10) offset++;
                continue;
            }
            break;
        }
        int start = offset;
        while (offset < source.Length && !char.IsWhiteSpace((char)source[offset])) offset++;
        return System.Text.Encoding.ASCII.GetString(source, start, offset - start);
    }

    private static void CheckTarget(ImagePoint[] corners, int rotation, int noise, bool clutter, int badBits = 0)
    {
        MarkerObservation result;
        bool found = detector.TryDetect(Render(corners, rotation, noise, clutter, badBits), 480, 400, out result);
        Assert(found, "Target must decode: rotation=" + rotation + ", noise=" + noise + ", badBits=" + badBits);
        Assert(result.BitErrors == badBits, "Payload error count is exact.");
        Assert(result.PixelArea > 1000, "Marker has a positive visible area.");
        for (int i = 0; i < 4; i++)
        {
            ImagePoint expected = corners[(i + rotation) % 4];
            double dx = result.Corners[i].X - expected.X, dy = result.Corners[i].Y - expected.Y;
            Assert(Math.Sqrt(dx * dx + dy * dy) < 3.2, "Canonical corner " + i + " matches printed target orientation: got " + result.Corners[i].X + "," + result.Corners[i].Y + ", expected " + expected.X + "," + expected.Y + "; rotation " + rotation + ".");
        }
    }

    // Independent projective rasterizer: invert the square-to-image homography
    // and classify each pixel inside the projected target.
    private static byte[] Render(ImagePoint[] corners, int rotation, int noise, bool clutter, int badBits = 0, bool mirrored = false)
    {
        const int width = 480, height = 400;
        var image = new byte[width * height];
        var random = new Random(1923 + rotation);
        double[] map = Homography(corners);
        double[] inverse = Invert(map);
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                double denominator = inverse[6] * x + inverse[7] * y + inverse[8];
                double u = (inverse[0] * x + inverse[1] * y + inverse[2]) / denominator;
                double v = (inverse[3] * x + inverse[4] * y + inverse[5]) / denominator;
                int value = 235;
                if (u >= 0 && v >= 0 && u < 1 && v < 1)
                {
                    int row = Math.Min(6, (int)(v * 7)), col = Math.Min(6, (int)(u * 7));
                    if (mirrored) col = 6 - col;
                    int sourceRow = row, sourceCol = col;
                    switch (rotation)
                    {
                        case 1: sourceRow = 6 - col; sourceCol = row; break;
                        case 2: sourceRow = 6 - row; sourceCol = 6 - col; break;
                        case 3: sourceRow = col; sourceCol = 6 - row; break;
                    }
                    bool light = MarkerDefinition.IsWhite(sourceRow, sourceCol);
                    if (badBits >= 1 && sourceRow == 2 && sourceCol == 2) light = !light;
                    if (badBits >= 2 && sourceRow == 3 && sourceCol == 3) light = !light;
                    value = light ? 224 : 30;
                }
                if (clutter && ((x > 12 && x < 57 && y > 20 && y < 64) || (x > 416 && x < 469 && y > 275 && y < 330))) value = 18;
                value += (int)(18.0 * x / width) + (noise > 0 ? random.Next(-noise, noise + 1) : 0);
                image[y * width + x] = (byte)Math.Clamp(value, 0, 255);
            }
        }
        return image;
    }

    private static double[] Homography(ImagePoint[] points)
    {
        // Eight-unknown linear solve, intentionally distinct from the detector's
        // analytic projective mapping implementation.
        var a = new double[8, 9];
        double[,] squareCoordinates = { { 0, 0 }, { 1, 0 }, { 1, 1 }, { 0, 1 } };
        for (int i = 0; i < 4; i++)
        {
            double u = squareCoordinates[i, 0], v = squareCoordinates[i, 1], x = points[i].X, y = points[i].Y;
            int r = i * 2;
            a[r, 0] = u; a[r, 1] = v; a[r, 2] = 1; a[r, 6] = -x * u; a[r, 7] = -x * v; a[r, 8] = x;
            a[r + 1, 3] = u; a[r + 1, 4] = v; a[r + 1, 5] = 1; a[r + 1, 6] = -y * u; a[r + 1, 7] = -y * v; a[r + 1, 8] = y;
        }
        for (int column = 0; column < 8; column++)
        {
            int pivot = column;
            for (int r = column + 1; r < 8; r++) if (Math.Abs(a[r, column]) > Math.Abs(a[pivot, column])) pivot = r;
            for (int c = column; c <= 8; c++) { double t = a[column, c]; a[column, c] = a[pivot, c]; a[pivot, c] = t; }
            double divisor = a[column, column];
            for (int c = column; c <= 8; c++) a[column, c] /= divisor;
            for (int r = 0; r < 8; r++)
                if (r != column)
                {
                    double scale = a[r, column];
                    for (int c = column; c <= 8; c++) a[r, c] -= scale * a[column, c];
                }
        }
        var result = new double[9];
        for (int i = 0; i < 8; i++) result[i] = a[i, 8];
        result[8] = 1;
        return result;
    }

    private static double[] Invert(double[] m)
    {
        double determinant = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
        return new[]
        {
            (m[4]*m[8]-m[5]*m[7])/determinant, (m[2]*m[7]-m[1]*m[8])/determinant, (m[1]*m[5]-m[2]*m[4])/determinant,
            (m[5]*m[6]-m[3]*m[8])/determinant, (m[0]*m[8]-m[2]*m[6])/determinant, (m[2]*m[3]-m[0]*m[5])/determinant,
            (m[3]*m[7]-m[4]*m[6])/determinant, (m[1]*m[6]-m[0]*m[7])/determinant, (m[0]*m[4]-m[1]*m[3])/determinant
        };
    }

    private static void Assert(bool condition, string message)
    {
        checks++;
        if (!condition) throw new Exception("FAIL: " + message);
    }

    private static void Throws<T>(Action action) where T : Exception
    {
        try { action(); }
        catch (T) { checks++; return; }
        throw new Exception("Expected " + typeof(T).Name);
    }
}
