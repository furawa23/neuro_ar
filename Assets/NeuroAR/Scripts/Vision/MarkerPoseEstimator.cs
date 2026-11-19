using System;

namespace NeuroAR.Vision
{
    public readonly struct CameraIntrinsics
    {
        public readonly double Fx;
        public readonly double Fy;
        public readonly double Cx;
        public readonly double Cy;

        public CameraIntrinsics(double fx, double fy, double cx, double cy)
        {
            Fx = fx; Fy = fy; Cx = cx; Cy = cy;
        }
    }

    /// <summary>Right-handed CV coordinates: X right, Y down, Z forward; metres and row-major rotation.</summary>
    public sealed class MarkerPose
    {
        public double[] Rotation;
        public double X;
        public double Y;
        public double Z;
        public double ReprojectionError;
    }

    /// <summary>
    /// Pose of a centred square from its four canonical corners. Homography
    /// decomposition is followed by polar orthogonalization and reprojection
    /// refinement. Distortion is not modelled: calibrated intrinsics improve accuracy.
    /// </summary>
    public static class MarkerPoseEstimator
    {
        public static bool TryEstimate(MarkerObservation observation, CameraIntrinsics intrinsics,
            double markerWidth, out MarkerPose pose)
        {
            pose = null;
            if (observation == null || observation.Corners == null || observation.Corners.Length != 4 ||
                !Finite(markerWidth) || markerWidth <= 0 || !ValidIntrinsics(intrinsics)) return false;
            ImagePoint[] corners = observation.Corners;
            if (!ValidQuad(corners)) return false;
            double half = markerWidth * 0.5;
            double[] worldX = { -half, half, half, -half };
            double[] worldY = { -half, -half, half, half };
            var equations = new double[8, 9];
            for (int i = 0; i < 4; i++)
            {
                double x = (corners[i].X - intrinsics.Cx) / intrinsics.Fx;
                double y = (corners[i].Y - intrinsics.Cy) / intrinsics.Fy;
                int row = i * 2;
                equations[row, 0] = worldX[i]; equations[row, 1] = worldY[i]; equations[row, 2] = 1;
                equations[row, 6] = -x * worldX[i]; equations[row, 7] = -x * worldY[i]; equations[row, 8] = x;
                equations[row + 1, 3] = worldX[i]; equations[row + 1, 4] = worldY[i]; equations[row + 1, 5] = 1;
                equations[row + 1, 6] = -y * worldX[i]; equations[row + 1, 7] = -y * worldY[i]; equations[row + 1, 8] = y;
            }
            if (!Solve(equations, 8, out double[] h)) return false;
            double[] a = { h[0], h[3], h[6] };
            double[] b = { h[1], h[4], h[7] };
            double normA = Norm(a), normB = Norm(b);
            if (!Finite(normA) || !Finite(normB) || normA < 1e-10 || normB < 1e-10 ||
                normA / normB < 0.2 || normA / normB > 5 || Math.Abs(Dot(a, b) / (normA * normB)) > 0.9) return false;
            double scale = 2 / (normA + normB);
            for (int i = 0; i < 3; i++) { a[i] *= scale; b[i] *= scale; }
            double[] c = Cross(a, b);
            var rotation = new[] { a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2] };
            if (!Orthogonalize(rotation)) return false;
            var translation = new[] { h[2] * scale, h[5] * scale, scale };
            double[] residuals = new double[8];
            double cost = Residuals(rotation, translation, worldX, worldY, corners, intrinsics, residuals);
            if (!Finite(cost)) return false;
            if (cost > 1e-10) Refine(ref rotation, ref translation, worldX, worldY, corners, intrinsics, ref cost, residuals);
            double error = Math.Sqrt(cost / 4);
            double edgeSum = 0;
            for (int i = 0; i < 4; i++) edgeSum += Distance(corners[i], corners[(i + 1) % 4]);
            // A large residual means the quadrilateral is not consistent with a
            // projected rigid square and the supplied camera intrinsics.
            if (!Finite(error) || error > Math.Max(2.5, edgeSum * 0.01) || translation[2] <= 0 || rotation[8] <= 0.005) return false;
            pose = new MarkerPose
            {
                Rotation = rotation, X = translation[0], Y = translation[1], Z = translation[2], ReprojectionError = error
            };
            return true;
        }

        private static void Refine(ref double[] rotation, ref double[] translation, double[] xs, double[] ys,
            ImagePoint[] corners, CameraIntrinsics k, ref double cost, double[] residuals)
        {
            double damping = 0.001;
            for (int iteration = 0; iteration < 15; iteration++)
            {
                var jacobian = new double[8, 6];
                for (int parameter = 0; parameter < 6; parameter++)
                {
                    double step = parameter < 3 ? 1e-5 : Math.Max(1e-7, translation[2] * 1e-6);
                    var delta = new double[6]; delta[parameter] = step;
                    Perturb(rotation, translation, delta, out double[] movedR, out double[] movedT);
                    var displaced = new double[8];
                    if (!Finite(Residuals(movedR, movedT, xs, ys, corners, k, displaced))) return;
                    for (int row = 0; row < 8; row++) jacobian[row, parameter] = (displaced[row] - residuals[row]) / step;
                }
                var system = new double[6, 7];
                for (int row = 0; row < 6; row++)
                {
                    for (int column = 0; column < 6; column++)
                        for (int r = 0; r < 8; r++) system[row, column] += jacobian[r, row] * jacobian[r, column];
                    system[row, row] += damping * (system[row, row] + 1);
                    for (int r = 0; r < 8; r++) system[row, 6] -= jacobian[r, row] * residuals[r];
                }
                if (!Solve(system, 6, out double[] update)) return;
                Perturb(rotation, translation, update, out double[] candidateR, out double[] candidateT);
                var candidateResiduals = new double[8];
                double candidateCost = Residuals(candidateR, candidateT, xs, ys, corners, k, candidateResiduals);
                if (Finite(candidateCost) && candidateCost < cost)
                {
                    double improvement = cost - candidateCost;
                    rotation = candidateR; translation = candidateT;
                    cost = candidateCost;
                    Array.Copy(candidateResiduals, residuals, 8);
                    damping = Math.Max(1e-9, damping * 0.3);
                    if (improvement < 1e-12) return;
                }
                else damping = Math.Min(1e9, damping * 10);
            }
        }

        private static void Perturb(double[] rotation, double[] translation, double[] delta,
            out double[] movedR, out double[] movedT)
        {
            double x = delta[0], y = delta[1], z = delta[2];
            double angleSquared = x * x + y * y + z * z;
            double angle = Math.Sqrt(angleSquared);
            double a = angle < 1e-8 ? 1 - angleSquared / 6 : Math.Sin(angle) / angle;
            double b = angle < 1e-8 ? 0.5 - angleSquared / 24 : (1 - Math.Cos(angle)) / angleSquared;
            double[] increment =
            {
                1 - b * (y * y + z * z), b * x * y - a * z, b * x * z + a * y,
                b * y * x + a * z, 1 - b * (x * x + z * z), b * y * z - a * x,
                b * z * x - a * y, b * z * y + a * x, 1 - b * (x * x + y * y)
            };
            movedR = new double[9];
            for (int row = 0; row < 3; row++)
                for (int column = 0; column < 3; column++)
                    for (int i = 0; i < 3; i++) movedR[row * 3 + column] += increment[row * 3 + i] * rotation[i * 3 + column];
            movedT = new[] { translation[0] + delta[3], translation[1] + delta[4], translation[2] + delta[5] };
        }

        private static double Residuals(double[] r, double[] t, double[] xs, double[] ys,
            ImagePoint[] corners, CameraIntrinsics k, double[] residuals)
        {
            double result = 0;
            for (int i = 0; i < 4; i++)
            {
                double x = r[0] * xs[i] + r[1] * ys[i] + t[0];
                double y = r[3] * xs[i] + r[4] * ys[i] + t[1];
                double z = r[6] * xs[i] + r[7] * ys[i] + t[2];
                if (!Finite(z) || z <= 1e-6) return double.PositiveInfinity;
                double dx = k.Fx * x / z + k.Cx - corners[i].X;
                double dy = k.Fy * y / z + k.Cy - corners[i].Y;
                residuals[i * 2] = dx; residuals[i * 2 + 1] = dy;
                result += dx * dx + dy * dy;
            }
            return result;
        }

        private static bool Orthogonalize(double[] r)
        {
            for (int iteration = 0; iteration < 8; iteration++)
            {
                double determinant = Determinant(r);
                if (!Finite(determinant) || determinant < 1e-12) return false;
                // Cofactor matrix is the inverse transpose multiplied by det.
                double[] cofactors =
                {
                    r[4] * r[8] - r[5] * r[7], r[5] * r[6] - r[3] * r[8], r[3] * r[7] - r[4] * r[6],
                    r[2] * r[7] - r[1] * r[8], r[0] * r[8] - r[2] * r[6], r[1] * r[6] - r[0] * r[7],
                    r[1] * r[5] - r[2] * r[4], r[2] * r[3] - r[0] * r[5], r[0] * r[4] - r[1] * r[3]
                };
                double change = 0;
                for (int i = 0; i < 9; i++)
                {
                    double value = 0.5 * (r[i] + cofactors[i] / determinant);
                    change = Math.Max(change, Math.Abs(value - r[i])); r[i] = value;
                }
                if (change < 1e-12) break;
            }
            return Math.Abs(Determinant(r) - 1) < 1e-6;
        }

        private static bool Solve(double[,] matrix, int dimension, out double[] solution)
        {
            solution = null;
            for (int column = 0; column < dimension; column++)
            {
                int pivot = column;
                for (int row = column + 1; row < dimension; row++)
                    if (Math.Abs(matrix[row, column]) > Math.Abs(matrix[pivot, column])) pivot = row;
                double divisor = matrix[pivot, column];
                if (!Finite(divisor) || Math.Abs(divisor) < 1e-13) return false;
                if (pivot != column)
                    for (int i = column; i <= dimension; i++)
                    {
                        double temporary = matrix[column, i]; matrix[column, i] = matrix[pivot, i]; matrix[pivot, i] = temporary;
                    }
                for (int i = column; i <= dimension; i++) matrix[column, i] /= divisor;
                for (int row = 0; row < dimension; row++)
                {
                    if (row == column) continue;
                    double multiple = matrix[row, column];
                    for (int i = column; i <= dimension; i++) matrix[row, i] -= multiple * matrix[column, i];
                }
            }
            solution = new double[dimension];
            for (int i = 0; i < dimension; i++)
            {
                if (!Finite(matrix[i, dimension])) return false;
                solution[i] = matrix[i, dimension];
            }
            return true;
        }

        private static bool ValidQuad(ImagePoint[] corners)
        {
            double area = 0;
            for (int i = 0; i < 4; i++)
            {
                ImagePoint a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
                if (!Finite(a.X) || !Finite(a.Y) || Distance(a, b) < 2) return false;
                if ((b.X - a.X) * (c.Y - b.Y) - (b.Y - a.Y) * (c.X - b.X) <= 0.01) return false;
                area += a.X * b.Y - a.Y * b.X;
            }
            return area > 32;
        }

        private static bool ValidIntrinsics(CameraIntrinsics k)
        {
            return Finite(k.Fx) && Finite(k.Fy) && k.Fx > 0 && k.Fy > 0 && Finite(k.Cx) && Finite(k.Cy);
        }
        private static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
        private static double Dot(double[] a, double[] b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
        private static double Norm(double[] vector) { return Math.Sqrt(Dot(vector, vector)); }
        private static double[] Cross(double[] a, double[] b) { return new[] { a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] }; }
        private static double Distance(ImagePoint a, ImagePoint b) { return Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y)); }
        private static double Determinant(double[] r) { return r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]); }
    }
}
